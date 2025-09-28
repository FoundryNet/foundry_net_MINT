// main.ts (Deno edge function)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nacl from "https://esm.sh/tweetnacl@1.0.3";
import bs58 from "https://esm.sh/bs58@4.0.1";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from "https://esm.sh/@solana/web3.js@1.95.2";
import { getOrCreateAssociatedTokenAccount, createTransferCheckedInstruction } from "https://esm.sh/@solana/spl-token@0.4.8";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
serve((req)=>router(req));
async function router(req) {
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  const url = new URL(req.url);
  try {
    if (req.method === "POST" && url.pathname.endsWith("/register-machine")) {
      return await handleRegisterMachine(req);
    }
    if (req.method === "POST" && url.pathname.endsWith("/submit-job")) {
      return await handleSubmitJob(req);
    }
    if (req.method === "POST" && url.pathname.endsWith("/complete-job")) {
      return await handleCompleteJob(req);
    }
    return new Response("Not Found", {
      status: 404
    });
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({
      error: String(err?.message ?? err)
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
}
/* ---------- helpers ---------- */ function getSupabaseClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key);
}
function parseJsonBody(req) {
  return req.json();
}
function makeConnection() {
  const rpc = "https://api.mainnet-beta.solana.com";
  return new Connection(rpc, "confirmed");
}
function loadTreasuryKeypair() {
  const secret = Deno.env.get("HOT_WALLET");
  if (!secret) throw new Error("HOT_WALLET secret not set");
  const arr = JSON.parse(secret);
  return Keypair.fromSecretKey(new Uint8Array(arr));
}
function mintDecimals() {
  return Number(Deno.env.get("MINT_DECIMALS") ?? "9");
}
function rewardPerJob() {
  return Number(Deno.env.get("REWARD_PER_JOB") ?? "3");
}
function dailyLimitPerMachine() {
  return Number(Deno.env.get("DAILY_LIMIT_PER_MACHINE") ?? "100");
}
/* ---------- endpoint handlers ---------- */ async function handleRegisterMachine(req) {
  const supabase = getSupabaseClient();
  const body = await parseJsonBody(req);
  const { machine_uuid, machine_pubkey_base58, owner_user_id, metadata } = body;
  if (!machine_uuid || !machine_pubkey_base58) {
    return new Response(JSON.stringify({
      error: "machine_uuid and machine_pubkey_base58 required"
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  // Insert or upsert machine record
  const { error } = await supabase.from("machines").upsert({
    machine_uuid,
    machine_pubkey: machine_pubkey_base58,
    owner_user_id,
    metadata: metadata ?? null
  }, {
    onConflict: [
      "machine_uuid"
    ]
  });
  if (error) {
    console.error("register-machine db error:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  return new Response(JSON.stringify({
    success: true
  }), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
async function handleSubmitJob(req) {
  const supabase = getSupabaseClient();
  const body = await parseJsonBody(req);
  const { machine_uuid, job_hash, payload } = body;
  if (!machine_uuid || !job_hash) {
    return new Response(JSON.stringify({
      error: "machine_uuid and job_hash required"
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  // If job exists, return 409 duplicate; else insert pending row
  const { data: existing } = await supabase.from("jobs").select("job_hash, status").eq("job_hash", job_hash).single();
  if (existing) {
    return new Response(JSON.stringify({
      success: false,
      error: "job_hash already exists",
      status: existing.status
    }), {
      status: 409,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  const { error } = await supabase.from("jobs").insert({
    job_hash,
    machine_uuid,
    job_payload: payload ?? null,
    status: "started",
    started_at: new Date().toISOString()
  });
  if (error) {
    console.error("submit-job insert error:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  return new Response(JSON.stringify({
    success: true,
    job_hash
  }), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
async function handleCompleteJob(req) {
  /**
   * Expects:
   * {
   *   machine_uuid,
   *   job_hash,
   *   recipient_wallet,         // recipient SOL address to receive SPL tokens
   *   completion_proof: {
   *      gcode_digest,          // optional: sha256:g...
   *      timestamp,             // ISO
   *      signature_base58       // base58-ed25519 signature of the "message" below
   *   }
   * }
   *
   * Message signed by machine should be: `${job_hash}|${recipient_wallet}|${timestamp}`
   */ const supabase = getSupabaseClient();
  const body = await parseJsonBody(req);
  const { machine_uuid, job_hash, recipient_wallet, completion_proof } = body;
  if (!machine_uuid || !job_hash || !recipient_wallet || !completion_proof) {
    return new Response(JSON.stringify({
      error: "machine_uuid, job_hash, recipient_wallet, completion_proof required"
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  // 1) Fetch job (or create if policy allows). We'll require existing job to reduce accidental payouts.
  const { data: jobRow } = await supabase.from("jobs").select("*").eq("job_hash", job_hash).single();
  if (!jobRow) {
    return new Response(JSON.stringify({
      error: "job not found; submit the job first"
    }), {
      status: 404,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  if (jobRow.status === "completed") {
    return new Response(JSON.stringify({
      success: true,
      tx_signature: jobRow.tx_signature
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  // 2) Verify machine registration and pubkey
  const { data: machine } = await supabase.from("machines").select("machine_pubkey").eq("machine_uuid", machine_uuid).single();
  if (!machine) {
    return new Response(JSON.stringify({
      error: "machine not registered"
    }), {
      status: 404,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  const machinePubBase58 = machine.machine_pubkey;
  // 3) Verify signature (ed25519)
  const { timestamp, signature_base58 } = completion_proof;
  if (!timestamp || !signature_base58) {
    return new Response(JSON.stringify({
      error: "completion_proof missing timestamp or signature_base58"
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  // Build message and verify
  const message = `${job_hash}|${recipient_wallet}|${timestamp}`;
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = bs58.decode(signature_base58);
  const pubkeyBytes = bs58.decode(machinePubBase58);
  const ok = nacl.sign.detached.verify(messageBytes, signatureBytes, pubkeyBytes);
  if (!ok) {
    return new Response(JSON.stringify({
      error: "signature verification failed"
    }), {
      status: 401,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  // 4) Rate-limit: sum rewards in last 24h for this machine
  const REWARD = rewardPerJob(); // e.g. 3
  const decimals = mintDecimals();
  const rewardBaseUnits = BigInt(Math.floor(REWARD * Math.pow(10, decimals)));
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: recentPayouts } = await supabase.from("payouts").select("amount").eq("machine_uuid", machine_uuid).gte("created_at", since);
  const totalLast24 = (recentPayouts ?? []).reduce((sum, r)=>sum + Number(r.amount || 0), 0);
  if (totalLast24 + REWARD > dailyLimitPerMachine()) {
    return new Response(JSON.stringify({
      error: "daily limit exceeded for machine"
    }), {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  // 5) Prepare on-chain transfer
  // We will: getOrCreateAssociatedTokenAccount (treasury pays for ATA if needed) and transfer
  const connection = makeConnection();
  const treasury = loadTreasuryKeypair();
  const mintAddress = Deno.env.get("MINT_ADDRESS");
  if (!mintAddress) throw new Error("MINT_ADDRESS not set");
  const mintPub = new PublicKey(mintAddress);
  // Determine treasury ATA
  const treasuryPub = treasury.publicKey;
  // source / sender associated token account
  const senderAta = await getOrCreateAssociatedTokenAccount(connection, treasury, mintPub, treasuryPub);
  // recipient ATA (it will be created and funded by treasury if missing)
  const recipientPubKey = new PublicKey(recipient_wallet);
  const recipientAta = await getOrCreateAssociatedTokenAccount(connection, treasury, mintPub, recipientPubKey);
  // TransferChecked instruction ensures decimals match
  const transferIx = createTransferCheckedInstruction(senderAta.address, mintPub, recipientAta.address, treasuryPub, rewardBaseUnits, decimals // decimals
  );
  const tx = new Transaction().add(transferIx);
  // sign and send
  const txSig = await sendAndConfirmTransaction(connection, tx, [
    treasury
  ], {
    skipPreflight: false,
    commitment: "confirmed"
  });
  // 6) Write DB rows in single logical flow (best effort)
  await supabase.from("payouts").insert({
    job_hash,
    machine_uuid,
    recipient: recipient_wallet,
    amount: REWARD,
    mint_address: mintAddress,
    tx_signature: txSig
  });
  await supabase.from("jobs").update({
    status: "completed",
    completed_at: new Date().toISOString(),
    completion_proof: completion_proof,
    reward_amount_numeric: REWARD,
    tx_signature: txSig,
    recipient_wallet
  }).eq("job_hash", job_hash);
  // 7) Return success with tx signature and solscan link
  const solscan = `https://solscan.io/tx/${txSig}?cluster=mainnet`;
  return new Response(JSON.stringify({
    success: true,
    tx_signature: txSig,
    solscan
  }), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
