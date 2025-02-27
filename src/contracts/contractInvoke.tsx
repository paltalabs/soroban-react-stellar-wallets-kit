import { SorobanContextType } from '..'

import * as StellarSdk from '@stellar/stellar-sdk'
import { rpc } from '@stellar/stellar-sdk'

import { contractTransaction } from './contractTransaction'
import { signAndSendTransaction } from './transaction'
import { TxResponse } from './types'

let xdr = StellarSdk.xdr

async function simulateTransactionWithRetry(
  sorobanServer: StellarSdk.rpc.Server,
  txn: StellarSdk.Transaction,
  maxRetries = 3,
  delay = 1000 // 1 second
): Promise<rpc.Api.SimulateTransactionResponse> {
  let attempts = 0;
  
  while (attempts < maxRetries) {
    try {
      const simulated: rpc.Api.SimulateTransactionResponse =
        await sorobanServer.simulateTransaction(txn);
      return simulated; // Success, return the result
    } catch (error) {
      attempts++;
      console.error(`Attempt ${attempts} failed:`, error);

      if (attempts >= maxRetries) {
        throw new Error(`Failed after ${maxRetries} attempts: ${error}`);
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error("Unexpected error: reached unreachable code.");
}



/**
 * Arguments for invoking a smart contract method call.
 */
export type InvokeArgs = {
  contractAddress: string
  method: string
  args?: StellarSdk.xdr.ScVal[] | undefined
  signAndSend?: boolean
  fee?: number
  skipAddingFootprint?: boolean
  secretKey?: string
  sorobanContext: SorobanContextType
  reconnectAfterTx?: boolean
  timeoutSeconds?: number
}

// Dummy source account for simulation. The public key for this is all 0-bytes.
const defaultAddress =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

/**
 * Invokes a smart contract method.
 * @param {InvokeArgs} args - Arguments for invoking the smart contract.
 * @returns {Promise<TxResponse | StellarSdk.xdr.ScVal>} - A promise resolving to the transaction response or the result of the simulation.
 * @throws {Error} - If there are errors during the contract invocation process.
 */
export async function contractInvoke({
  contractAddress,
  method,
  args = [],
  signAndSend = false,
  fee = 100,
  skipAddingFootprint,
  secretKey,
  sorobanContext,
  reconnectAfterTx = true,
  timeoutSeconds = 20,
}: InvokeArgs): Promise<TxResponse | StellarSdk.xdr.ScVal> {
  const { sorobanServer, address, activeNetwork } = sorobanContext  

  if (!activeNetwork) {

    throw new Error('No active Chain')
  }
  if (!sorobanServer) {

    throw new Error('No connected to a Server..')
  }

  const networkPassphrase = activeNetwork;
  let source = null

  if (signAndSend) {
    if (secretKey) {
        source = await sorobanServer.getAccount(
          StellarSdk.Keypair.fromSecret(secretKey).publicKey()
        )
      } else {
          if (!address) throw new Error('No address')
            try {
                source = await sorobanServer.getAccount(address)
            } catch (e) {
              console.log('Error getting account', e)
              throw new Error('Error getting account')
            }

      }
    } else {
    source = new StellarSdk.Account(defaultAddress, '0')
  }

  

  //Builds the transaction
  let txn = contractTransaction({
    source,
    networkPassphrase,
    contractAddress,
    method,
    args,
  })
  

  const simulated: rpc.Api.SimulateTransactionResponse = 
    await simulateTransactionWithRetry(sorobanServer, txn)

  if (rpc.Api.isSimulationError(simulated)) {
    throw new Error(simulated.error)
  } else if (!simulated.result) {
    throw new Error(`invalid simulation: no result in ${simulated}`)
  }

  if (!signAndSend && simulated) {
    return simulated.result.retval
  } else {
    // If signAndSend
    const res = await signAndSendTransaction({
      txn,
      skipAddingFootprint,
      secretKey,
      sorobanContext,
      timeoutSeconds,
    })

    if (reconnectAfterTx) {
      sorobanContext.connect()
    }

    return res
  }
}
