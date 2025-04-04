import React, { useRef, useState } from 'react'
import {
  ContractDeploymentInfo, 
  NetworkDetails, 
  WalletNetwork, 
  SorobanContextType 
} from './types'

import * as StellarSdk from '@stellar/stellar-sdk'
import { SorobanContext } from '.'

import {
  StellarWalletsKit,
  allowAllModules,
  FREIGHTER_ID,
  ModuleInterface,
  ISupportedWallet,
  XBULL_ID
} from '@creit.tech/stellar-wallets-kit';
import { isAllowed } from "@stellar/freighter-api";

export interface SorobanReactProviderProps {
  appName?: string
  allowedNetworkDetails: NetworkDetails[]
  activeNetwork: WalletNetwork
  children: React.ReactNode
  modules?: ModuleInterface[]
  deployments?: ContractDeploymentInfo[]
}
/**
 * Converts a Soroban RPC URL to a Soroban RPC Server object.
 * @param {string} sorobanRpcUrl - Soroban RPC URL.
 * @returns {StellarSdk.rpc.Server} - Soroban RPC Server object.
 */
export function fromURLToServer(sorobanRpcUrl: string): StellarSdk.rpc.Server {
  let opts = {
    allowHttp: sorobanRpcUrl.startsWith("http://"),
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({}),
  };

  try {
    const url = new URL(sorobanRpcUrl);
    return new StellarSdk.rpc.Server(url.toString(), opts);
  } catch (error) {
    console.error("Invalid Soroban RPC URL:", error);
    throw new Error("Invalid Soroban RPC URL provided.");
  }
}

export function fromURLToHorizonServer(networkUrl: string): StellarSdk.Horizon.Server {
  return new StellarSdk.Horizon.Server(networkUrl, {
    allowHttp: networkUrl.startsWith('http://'),
  });
}


/**
 * SorobanReactProvider component.
 * Provides context for Soroban React application.
 * @param {SorobanReactProviderProps} props - Props for the component.
 */
export function SorobanReactProvider({
  appName,
  allowedNetworkDetails,
  activeNetwork = WalletNetwork.TESTNET, // Non mandatory fields default to default Context fields value
  modules,
  deployments = [],
  children,
}: SorobanReactProviderProps) {

  const kitRef = useRef<StellarWalletsKit | null>(null);
  const isConnectedRef = useRef(false)

  const activeNetworkDetails: NetworkDetails | undefined = allowedNetworkDetails.find(
    (details) => details.network === activeNetwork
  );

  if (!activeNetworkDetails) {
    throw new Error(`Active network details not found for chain: ${activeNetwork}`);
  }

  let sorobanServer = fromURLToServer(activeNetworkDetails.sorobanRpcUrl);
  let horizonServer = fromURLToHorizonServer(activeNetworkDetails.horizonRpcUrl);

  const [mySorobanContext, setSorobanContext] = useState<SorobanContextType>({
      appName,
      allowedNetworkDetails,
      activeNetwork,
      deployments,
      modules,
      sorobanServer,
      horizonServer,
      selectedModuleId: undefined,
      connect: async () => {
        try {
          kitRef.current = new StellarWalletsKit({
            network: activeNetwork,
            selectedWalletId: XBULL_ID,
            modules: modules ? modules : allowAllModules(),
          });

          await kitRef.current.openModal({
            onWalletSelected: async (option: ISupportedWallet) => {
              
              const selectedModuleId = option.id;
              kitRef.current.setWallet(selectedModuleId);

              const { address } = await kitRef.current.getAddress();

              if (selectedModuleId === FREIGHTER_ID) {
                const { networkPassphrase } = await kitRef.current.getNetwork();
                const activeNetworkDetails: NetworkDetails | undefined = allowedNetworkDetails.find((allowedNetworkDetails) => allowedNetworkDetails.network === networkPassphrase);

                if (!activeNetworkDetails) {
                    throw new Error(`Your Wallet network is not supported in this app. Please change to one of the supported networks: ${allowedNetworkDetails}`)
                }
                else {
                  activeNetwork = networkPassphrase as WalletNetwork;
                  sorobanServer = fromURLToServer(activeNetworkDetails.sorobanRpcUrl);
                  horizonServer = fromURLToHorizonServer(activeNetworkDetails.horizonRpcUrl);
                  
                }
              } 
              
              isConnectedRef.current = true
              
              

              setSorobanContext((c: any) => ({
                ...c,
                selectedModuleId,
                activeNetwork,
                address,
                sorobanServer,
                horizonServer,
                kit: kitRef.current
              }))
              
            },
                  });
        }
        catch(e){
          console.log("Failed to connect wallet kit with error: ", e)
        }
      },
      disconnect: async () => {
        isConnectedRef.current = false
        kitRef.current = null; // Reset the kit reference

        setSorobanContext((c: any) => ({
          ...c,
          selectedModuleId: undefined,
          address: undefined,
          kit: null, // Also remove kit from context if necessary
        }));

      },

      // todo: set RPC urls
      setActiveNetwork: (network: WalletNetwork) => {
        const activeNetworkDetails: NetworkDetails | undefined = allowedNetworkDetails.find((allowedNetworkDetails) => allowedNetworkDetails.network === network);
        
        if (!activeNetworkDetails) {
          console.error(`Please change to one of the supported networks:`, allowedNetworkDetails)
          throw new Error(`Active network details not found for chain: ${activeNetwork}`);
        }

        const sorobanServer = fromURLToServer(activeNetworkDetails.sorobanRpcUrl);
        const horizonServer = fromURLToHorizonServer(activeNetworkDetails.horizonRpcUrl);

        setSorobanContext((c: any) => ({
          ...c,
          sorobanServer,
          horizonServer,
          activeNetwork,
        }))
      },

      setActiveWalletAndConnect: async (wallet: string) => {
        if (!kitRef.current) {
          kitRef.current = new StellarWalletsKit({
            network: activeNetwork,
            selectedWalletId: XBULL_ID,
            modules: modules ? modules : allowAllModules(),
          });
        }
        console.log('Changing wallet to ', wallet)
        kitRef.current.setWallet(wallet)
        let { address } = await kitRef.current.getAddress();
        isConnectedRef.current = true
        setSorobanContext((c: any) => ({
          ...c,
          address,
        }))
      },
    })

  async function checkFreighterDisconnected(): Promise<boolean> {
    // only for freighter
    if (mySorobanContext.selectedModuleId !== FREIGHTER_ID) return false;
  
    const { isAllowed: appIsAllowed, error } = await isAllowed();
  
    if (error) {
      console.error('Error checking if app is allowed:', error);
      return false;
    }
  
    if (!appIsAllowed) {
      console.warn('App is not allowed anymore by Freighter.');
      await mySorobanContext.disconnect();
      return true;
    }
  
    return false;
  }

  // Handle changes of address in "realtime"
  React.useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null

    // If it turns out that requesting an update from Freighter is too taxing,
    // then this could be increased. Humans perceive 100ms response times as instantaneous
    // (source: https://www.pubnub.com/blog/how-fast-is-realtime-human-perception-and-technology/)
    // but you also have to consider the re-render time of components.
    const freighterCheckIntervalMs = 200

    async function checkForAddressChanges() {
      
      
      if (!mySorobanContext.kit || !isConnectedRef.current || !mySorobanContext.selectedModuleId) return

      // TODO Something is going on that when .getAddress() is called and xbull is open, it closes the modal!
      if (mySorobanContext.selectedModuleId !== FREIGHTER_ID) return

      if (await checkFreighterDisconnected()) return 

      let hasNoticedWalletUpdate = false

      try {
        
        // TODO: If you want to know when the user has disconnected, then you can set a timeout for getPublicKey.
        // If it doesn't return in X milliseconds, you can be pretty confident that they aren't connected anymore.
        // use https://docs.freighter.app/docs/guide/usingFreighterWebApp#watchwalletchanges
        let { address } = await mySorobanContext.kit.getAddress()
      
        if (mySorobanContext.address !== address) {
          console.log(
            'SorobanReactProvider: address changed from:',
            mySorobanContext.address,
            ' to: ',
            address
          )
          hasNoticedWalletUpdate = true

          setSorobanContext((c: any) => ({
            ...c,
            address,
          }))
        }
      } catch (error) {
        // I would recommend keeping the try/catch so that any exceptions in this async function
        // will get handled. Otherwise React could complain. I believe that eventually it may cause huge
        // problems, but that might be a NodeJS specific approach to exceptions not handled in promises.

        console.error('SorobanReactProvider: error while getting address changes: ', error)
      } finally {
        if (!hasNoticedWalletUpdate)
          timeoutId = setTimeout(
            checkForAddressChanges,
            freighterCheckIntervalMs
          )
      }
    }

    checkForAddressChanges()

    return () => {
      if (timeoutId != null) clearTimeout(timeoutId)
    }
  }, [mySorobanContext])

  // Handle changes of network in "realtime" if getNetworkDetails exists
  // this works for Freighter. We can also use this function to check
  // for other changes in the wallet, like if the user has disconnected.
  React.useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null
    const freighterCheckIntervalMs = 200

    async function checkForNetworkChanges() {
      if (
        !mySorobanContext.kit   || 
        !isConnectedRef.current || 
        !mySorobanContext.selectedModuleId ||
        // network changes are only supported by freighter
        mySorobanContext.selectedModuleId !== FREIGHTER_ID
      ) return
      if (await checkFreighterDisconnected()) return 
      
      await checkFreighterDisconnected()
      let hasNoticedWalletUpdate = false

      try {
        const {networkPassphrase } = await mySorobanContext.kit.getNetwork()
        if (!networkPassphrase) {
          console.error('SorobanReactProvider: networkPassphrase is empty')
          return
        }
        const activeNetwork = networkPassphrase as WalletNetwork;
        // We check that we have a valid network details and not a blank one like the one xbull connector would return
        if (activeNetwork !== mySorobanContext.activeNetwork) {
          console.log(
            'SorobanReactProvider: network changed from:',
            mySorobanContext.activeNetwork,
            ' to: ',
            networkPassphrase
          )
          hasNoticedWalletUpdate = true

          const activeNetworkDetails: NetworkDetails | undefined = allowedNetworkDetails.find((allowedNetworkDetails) => allowedNetworkDetails.network === networkPassphrase);
                  
          if (!activeNetworkDetails) {
            console.error(`Please change to one of the supported networks:`, allowedNetworkDetails)
            throw new Error(`Active network details not found for chain: ${activeNetwork}`);
          }
  
          const sorobanServer = fromURLToServer(activeNetworkDetails.sorobanRpcUrl);
          const horizonServer = fromURLToHorizonServer(activeNetworkDetails.horizonRpcUrl);
  
          setSorobanContext((c: any) => ({
            ...c,
            sorobanServer,
            horizonServer,
            activeNetwork,
          }))
          
        }
      } catch (error) {
        console.error('SorobanReactProvider: error while getting network changes: ', error)
      } finally {
        if (!hasNoticedWalletUpdate)
          timeoutId = setTimeout(
            checkForNetworkChanges,
            freighterCheckIntervalMs
          )
      }
    }

    checkForNetworkChanges()

    return () => {
      if (timeoutId != null) clearTimeout(timeoutId)
    }
  }, [mySorobanContext])

  return (
    <SorobanContext.Provider value={mySorobanContext}>
      {children}
    </SorobanContext.Provider>
  )
}
