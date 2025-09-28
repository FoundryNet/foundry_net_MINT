import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Connection, PublicKey, Keypair } from 'https://esm.sh/@solana/web3.js@1.95.2';
import { getOrCreateAssociatedTokenAccount, mintTo } from 'https://esm.sh/@solana/spl-token@0.4.8';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  console.log('=== REAL MINT TOKEN REQUEST ===');
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    console.log('CORS preflight - returning headers');
    return new Response('ok', {
      headers: corsHeaders
    });
  }
  try {
    console.log('Initializing Supabase client...');
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    console.log('Parsing request body...');
    const requestBody = await req.json();
    console.log('Request body:', requestBody);
    const { recipientAddress, mintAmount, activityType = 'job_completion', machineId } = requestBody;
    // Validate required parameters
    if (!recipientAddress || !mintAmount) {
      console.error('Missing required parameters:', {
        recipientAddress,
        mintAmount
      });
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required parameters: recipientAddress or mintAmount'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Get token configuration from database
    console.log('Fetching token configuration...');
    const { data: configData, error: configError } = await supabase.from('solana_config').select('config_value').eq('config_key', 'mint_token_config').single();
    if (configError || !configData) {
      console.error('Failed to fetch token config:', configError);
      return new Response(JSON.stringify({
        success: false,
        error: 'Token configuration not found'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const tokenConfig = configData.config_value;
    console.log('Token config:', tokenConfig);
    if (!tokenConfig.enabled) {
      console.log('Token system is disabled');
      return new Response(JSON.stringify({
        success: false,
        error: 'MINT token system is disabled'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const mintAddress = tokenConfig.mint_address;
    if (!mintAddress) {
      console.error('No mint address configured');
      return new Response(JSON.stringify({
        success: false,
        error: 'No mint address configured'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Initialize Solana connection
    console.log('Connecting to Solana devnet...');
    const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
    // Get mint authority keypair from environment
    const mintAuthorityKeypairJson = Deno.env.get('SOLANA_MINT_AUTHORITY_KEYPAIR');
    if (!mintAuthorityKeypairJson) {
      console.error('No mint authority keypair found');
      return new Response(JSON.stringify({
        success: false,
        error: 'Mint authority keypair not configured'
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log('Parsing mint authority keypair...');
    const mintAuthorityKeypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(mintAuthorityKeypairJson)));
    console.log('Mint authority public key:', mintAuthorityKeypair.publicKey.toBase58());
    // Convert addresses to PublicKey objects
    const mintPublicKey = new PublicKey(mintAddress);
    const recipientPublicKey = new PublicKey(recipientAddress);
    console.log('Creating/getting associated token account...');
    // Get or create associated token account for recipient
    const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(connection, mintAuthorityKeypair, mintPublicKey, recipientPublicKey);
    console.log('Recipient token account:', recipientTokenAccount.address.toBase58());
    // Calculate mint amount with decimals
    const decimals = tokenConfig.decimals || 9;
    const mintAmountWithDecimals = mintAmount * Math.pow(10, decimals);
    console.log('Minting tokens...', {
      mintAmount,
      decimals,
      mintAmountWithDecimals
    });
    // Mint tokens to recipient
    const mintTxSignature = await mintTo(connection, mintAuthorityKeypair, mintPublicKey, recipientTokenAccount.address, mintAuthorityKeypair, mintAmountWithDecimals // amount
    );
    console.log('Mint transaction signature:', mintTxSignature);
    // Get user ID from recipient wallet address
    const userId = await getUserIdFromWallet(supabase, recipientAddress);
    console.log('Found user ID:', userId);
    // Award MINT to user using the database function
    console.log('Updating user MINT balance...');
    const { error: awardError } = await supabase.rpc('award_mint_to_user', {
      p_user_id: userId,
      p_mint_amount: parseFloat(mintAmount),
      p_activity_type: activityType
    });
    if (awardError) {
      console.error('Error updating user MINT balance:', awardError);
    // Don't fail the whole operation since the tokens were minted successfully
    }
    console.log('Successfully minted and awarded MINT tokens');
    // Return success response with transaction details
    const response = {
      success: true,
      transactionHash: mintTxSignature,
      recipientAddress,
      mintAmount: parseFloat(mintAmount),
      mintAddress,
      tokenAccount: recipientTokenAccount.address.toBase58(),
      activityType,
      message: 'MINT tokens minted successfully on Solana devnet'
    };
    console.log('Returning success response:', response);
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error in solana-mint function:', error);
    return new Response(JSON.stringify({
      success: false,
      error: `Minting failed: ${error.message}`
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
async function getUserIdFromWallet(supabase, walletAddress) {
  const { data, error } = await supabase.from('solana_wallets').select('user_id').eq('public_key', walletAddress).eq('is_primary', true).single();
  if (error || !data) {
    throw new Error(`No user found for wallet: ${walletAddress}`);
  }
  return data.user_id;
}
