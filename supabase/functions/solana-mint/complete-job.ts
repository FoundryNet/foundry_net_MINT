import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nacl from "https://esm.sh/tweetnacl@1.0.3";
import bs58 from "https://esm.sh/bs58@4.0.1";
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "https://esm.sh/@solana/web3.js@1.95.2";
import { getOrCreateAssociatedTokenAccount, createTransferCheckedInstruction } from "https://esm.sh/@solana/spl-token@0.4.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function getSupabaseClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

function makeConnection() {
  const rpc = Deno.env.get("SOLANA_RPC") ?? "https://api.mainnet-beta.solana.com";
  return new Connection(rpc, "confirmed");
}

function loadTreasuryKeypair() {
  const secret = Deno.env.get("HOT_WALLET");
  if (!secret) throw new Error("HOT_WALLET secret not set");
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(secret)));
}

function rewardPerJob() {
  return Number(Deno.env.get("Reward_Per_Job") ?? "3");
}

function mintDecimals() {
  return Number(Deno.env.get("Mint_Decimals") ?? "9");
}

function dailyLimitPerMachine() {
  return Number(Deno.env.get("Daily_Limit_Per_Machine") ?? "100");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = getSupabaseClient();
    const body = await req.json();
    const { machine_uuid, job_hash, recipient_wallet, completion_proof } = body;

    if (!machine_uuid || !job_hash || !recipient_wallet || !completion_proof) {
      return new Response(
        JSON.stringify({ success: false, error: "machine_uuid, job_hash, recipient_wallet, completion_proof required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1) Fetch job
    const { data: jobRow } = await supabase.from("jobs").select("*").eq("job_hash", job_hash).single();
    if (!jobRow) return new Response(JSON.stringify({ error: "job not found; submit the job first" }), { status: 404, headers: corsHeaders });
    if (jobRow.status === "completed") return new Response(JSON.stringify({ success: true, tx_signature: jobRow.tx_signature }), { status: 200, headers: corsHeaders });

    // 2) Verify machine
    const { data: machine } = await supabase.from("machines").select("machine_pubkey").eq("machine_uuid", machine_uuid).single();
    if (!machine) return new Response(JSON.stringify({ error: "machine not registered" }), { status: 404, headers: corsHeaders });

    // 3) Verify signature
    const message = `${job_hash}|${recipient_wallet}|${completion_proof.timestamp}`;
    const verified = nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      bs58.decode(completion_proof.signature_base58),
      bs58.decode(machine.machine_pubkey)
    );
    if (!verified) return new Response(JSON.stringify({ error: "signature verification failed" }), { status: 401, headers: corsHeaders });

    // 4) Rate limit
    const reward = rewardPerJob();
    const decimals = mintDecimals();
    const rewardBaseUnits = BigInt(Math.floor(reward * Math.pow(10, decimals)));
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: recent } = await supabase.from("payouts").select("amount").eq("machine_uuid", machine_uuid).gte("created_at", since);
    const totalLast24 = (recent ?? []).reduce((sum, r) => sum + Number(r.amount || 0), 0);
    if (totalLast24 + reward > dailyLimitPerMachine()) return new Response(JSON.stringify({ error: "daily limit exceeded for machine" }), { status: 429, headers: corsHeaders });

    // 5) Solana transfer
    const connection = makeConnection();
    const treasury = loadTreasuryKeypair();
    const mintPub = new PublicKey(Deno.env.get("Mint_Address")!);
    const treasuryAta = await getOrCreateAssociatedTokenAccount(connection, treasury, mintPub, treasury.publicKey);
    const recipientPub = new PublicKey(recipient_wallet);
    const recipientAta = await getOrCreateAssociatedTokenAccount(connection, treasury, mintPub, recipientPub);
    const transferIx = createTransferCheckedInstruction(treasuryAta.address, mintPub, recipientAta.address, treasury.publicKey, rewardBaseUnits, decimals);
    const tx = new Transaction().add(transferIx);
    const txSig = await sendAndConfirmTransaction(connection, tx, [treasury], { skipPreflight: false, commitment: "confirmed" });

    // 6) Update DB
    await supabase.from("payouts").insert({ job_hash, machine_uuid, recipient: recipient_wallet, amount: reward, mint_address: mintPub.toBase58(), tx_signature: txSig });
    await supabase.from("jobs").update({ status: "completed", completed_at: new Date().toISOString(), tx_signature: txSig, recipient_wallet }).eq("job_hash", job_hash);

    return new Response(JSON.stringify({ success: true, tx_signature: txSig, solscan: `https://solscan.io/tx/${txSig}?cluster=mainnet` }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("complete-job error:", err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
