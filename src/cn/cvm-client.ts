import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ApplesauceRelayPool, NostrClientTransport, PrivateKeySigner } from '@contextvm/sdk';
import type { CnConfig } from './config.js';

export interface CvmConnectionResult {
  client: Client;
  serverDetails: any;
  toolListResult: any;
}

export async function createCvmConnection(
  pubkey: string,
  config: CnConfig,
  clientName: string = 'cvmi-cn-client'
): Promise<CvmConnectionResult> {
  const client = new Client(
    {
      name: clientName,
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  const transport = new NostrClientTransport({
    signer: config.privateKey ? new PrivateKeySigner(config.privateKey) : new PrivateKeySigner(''),
    relayHandler: new ApplesauceRelayPool(config.relays),
    serverPubkey: pubkey,
  });

  try {
    await client.connect(transport);
    const serverDetails = client.getServerVersion();
    const toolListResult = await client.listTools();

    console.log(JSON.stringify(toolListResult));
    await transport.close();

    return {
      client,
      serverDetails,
      toolListResult,
    };
  } catch (error) {
    await transport.close().catch(() => {}); // Ignore close errors
    throw error;
  }
}
