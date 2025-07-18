import { TokenConfig, Network, VestingConfig } from '../types';
import { PresaleConfig } from '../types/presale';
import { AppError, ErrorType, reportError } from './errorHandler';
import { web3Service } from './web3Service';
import { MODE_STORAGE_KEY, DEFAULT_MODE } from '../config/constants';

export interface DeploymentResult {
  contractAddress: string;
  transactionHash: string;
  network: Network;
  explorerUrl: string;
  gasUsed: string;
  deploymentCost: string;
}

export class ContractService {
  private apiUrl: string;
  private authToken: string | null = null;

  constructor() {
    this.apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    
    // Initialize with the current network mode
    this.isTestnetMode = localStorage.getItem(MODE_STORAGE_KEY) === 'testnet';
  }
  
  // Track current network mode
  private isTestnetMode: boolean = false;

  async authenticate(address: string, signature: string, message: string): Promise<string> {
    try {
      const response = await fetch(`${this.apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ address, signature, message }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Authentication failed');
      }

      const data = await response.json();
      this.authToken = data.token;
      localStorage.setItem('authToken', data.token);
      return data.token;
    } catch (error) {
      console.error('Authentication error:', error);
      throw new AppError('Authentication failed', ErrorType.AUTHENTICATION, error);
    }
  }

  async getAuthMessage(address: string): Promise<string> {
    try {
      const response = await fetch(`${this.apiUrl}/api/auth/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ address }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get auth message');
      }

      const data = await response.json();
      return data.message;
    } catch (error) {
      console.error('Get auth message error:', error);
      throw new AppError('Failed to get authentication message', ErrorType.SERVER, error);
    }
  }

  private getAuthHeaders(): Record<string, string> {
    const token = this.authToken || localStorage.getItem('authToken');
    return {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
    };
  }

  private getContractType(config: TokenConfig): string {
    const features = config.features;
    
    if (features.burnable && features.mintable && features.transferFees.enabled && features.holderRedistribution.enabled) {
      return 'AdvancedToken';
    } else if (features.burnable && features.mintable && features.transferFees.enabled) {
      return 'BurnableMintableFeeToken';
    } else if (features.burnable && features.mintable && features.holderRedistribution.enabled) {
      return 'BurnableMintableRedistributionToken';
    } else if (features.burnable && features.mintable) {
      return 'BurnableMintableToken';
    } else if (features.burnable) {
      return 'BurnableToken';
    } else if (features.mintable) {
      return 'MintableToken';
    } else if (features.transferFees.enabled) {
      return 'FeeToken';
    } else if (features.holderRedistribution.enabled) {
      return 'RedistributionToken';
    } else {
      return 'BasicToken';
    }
  }

  private getConstructorParams(config: TokenConfig): any[] {
    const contractType = this.getContractType(config);
    const baseParams = [
      config.name,
      config.symbol,
      config.decimals,
      config.initialSupply,
      config.maxSupply || '0',
    ];

    switch (contractType) {
      case 'FeeToken':
        return [
          ...baseParams,
          Math.floor(config.features.transferFees.percentage * 100),
          config.features.transferFees.recipient,
          'DEPLOYER_ADDRESS' // Will be replaced by backend
        ];
      case 'RedistributionToken':
        return [
          ...baseParams,
          Math.floor(config.features.holderRedistribution.percentage * 100),
          'DEPLOYER_ADDRESS'
        ];
      case 'AdvancedToken':
        return [
          ...baseParams,
          Math.floor(config.features.transferFees.percentage * 100),
          config.features.transferFees.recipient,
          Math.floor(config.features.holderRedistribution.percentage * 100),
          'DEPLOYER_ADDRESS'
        ];
      default:
        return [...baseParams, 'DEPLOYER_ADDRESS'];
    }
  }

  async estimateDeploymentCost(config: TokenConfig): Promise<{
    gasEstimate: string;
    gasCost: string;
    gasCostUsd: string;
    timeEstimate: string;
    useFactory: boolean;
  }> {
    try {
      const contractType = this.getContractType(config);
      const constructorParams = this.getConstructorParams(config);
      
      // Get gas estimate from web3Service
      const estimate = await web3Service.estimateTokenDeploymentGas(contractType, constructorParams);
      
      // Determine if factory should be used (cheaper for standard tokens)
      const useFactory = ['BasicToken', 'BurnableToken', 'MintableToken', 'BurnableMintableToken'].includes(contractType);
      
      // If using factory, reduce gas cost by approximately 30%
      const factoryDiscount = useFactory ? 0.7 : 1.0;
      
      return {
        gasEstimate: estimate.gasEstimate.toString(),
        gasCost: (parseFloat(estimate.gasCost) * factoryDiscount).toFixed(6),
        gasCostUsd: estimate.gasCostUsd,
        timeEstimate: estimate.timeEstimate,
        useFactory
      };
    } catch (error) {
      console.error('Error estimating deployment cost:', error);
      reportError(new AppError('Failed to estimate deployment cost', ErrorType.CONTRACT, error));
      
      // Return fallback estimates
      return {
        gasEstimate: '0',
        gasCost: '0.0',
        gasCostUsd: '$0.00',
        timeEstimate: '1-3 minutes',
        useFactory: false
      };
    }
  }

  async deployToken(config: TokenConfig): Promise<DeploymentResult> {
    try {
      const contractType = this.getContractType(config);
      const constructorParams = this.getConstructorParams(config);
      const useFactory = config.useFactory !== undefined ? 
        config.useFactory : 
        ['BasicToken', 'BurnableToken', 'MintableToken', 'BurnableMintableToken'].includes(contractType);
      
      // Check if we're on the correct network
      const currentNetwork = await web3Service.getCurrentNetwork();
      if (currentNetwork?.chainId !== config.network.chainId) {
        try {
          await web3Service.switchNetwork(config.network);
        } catch (error) {
          throw new AppError(
            `Please switch to ${config.network.name} network before deploying`,
            ErrorType.NETWORK,
            error
          );
        }
      }

      // Check if user has enough ESR tokens for mainnet deployment
      if (!config.network.id.includes('testnet') && !config.network.id.includes('goerli') && !config.network.id.includes('sepolia')) {
        try {
          const esrBalance = await this.checkESRBalance(await web3Service.getSigner()?.getAddress() || '');
          const requiredBalance = 100; // 100 ESR tokens required
          
          if (esrBalance < requiredBalance) {
            throw new AppError(
              `Insufficient ESR tokens. Required: ${requiredBalance}, Available: ${esrBalance.toFixed(2)}`,
              ErrorType.VALIDATION
            );
          }
          
          // Deduct ESR tokens
          await this.deductESRTokens(requiredBalance);
        } catch (balanceError) {
          if (balanceError instanceof AppError) {
            throw balanceError;
          } else {
            throw new AppError('Failed to check or deduct ESR tokens', ErrorType.VALIDATION, balanceError);
          }
        }
      }

      const response = await fetch(`${this.apiUrl}/api/deploy/token`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          contractType,
          constructorArgs: constructorParams,
          network: config.network.id,
          verify: true,
          useFactory
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Deployment failed';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.details || 'Deployment failed';
        } catch (e) {
          // If we can't parse the JSON, use the status text
          errorMessage = `Deployment failed: ${response.status} ${response.statusText}`;
        }
        throw new AppError(errorMessage, ErrorType.SERVER);
      }

      const result = await response.json();

      return {
        contractAddress: result.contractAddress,
        transactionHash: result.transactionHash,
        tokenName: config.name,
        tokenSymbol: config.symbol,
        network: config.network,
        explorerUrl: `${config.network.explorerUrl}/token/${result.contractAddress}`,
        gasUsed: result.gasUsed,
        deploymentCost: result.deploymentCost
      };
    } catch (error) {
      console.error('Error deploying token:', error);
      if (error instanceof AppError) {
        throw error;
      } else {
        throw new AppError(
          (error as Error).message || 'Token deployment failed',
          ErrorType.UNKNOWN,
          error
        );
      }
    }
  }

  async deployPresale(config: PresaleConfig): Promise<DeploymentResult> {
    try {
      // Check if we're on the correct network
      const currentNetwork = await web3Service.getCurrentNetwork();
      if (currentNetwork?.chainId !== config.network.chainId) {
        try {
          await web3Service.switchNetwork(config.network);
        } catch (error) {
          throw new AppError(
            `Please switch to ${config.network.name} network before deploying`,
            ErrorType.NETWORK,
            error
          );
        }
      }
      
      // Check if user has enough ESR tokens for mainnet deployment
      if (!config.network.id.includes('testnet') && !config.network.id.includes('goerli') && !config.network.id.includes('sepolia')) {
        try {
          const esrBalance = await this.checkESRBalance(await web3Service.getSigner()?.getAddress() || '');
          const requiredBalance = 100; // 100 ESR tokens required
          
          if (esrBalance < requiredBalance) {
            throw new AppError(
              `Insufficient ESR tokens. Required: ${requiredBalance}, Available: ${esrBalance.toFixed(2)}`,
              ErrorType.VALIDATION
            );
          }
          
          // Deduct ESR tokens
          await this.deductESRTokens(requiredBalance);
        } catch (balanceError) {
          if (balanceError instanceof AppError) {
            throw balanceError;
          } else {
            throw new AppError('Failed to check or deduct ESR tokens', ErrorType.VALIDATION, balanceError);
          }
        }
      }
      
      const response = await fetch(`${this.apiUrl}/api/deploy/presale`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          presaleConfig: config,
          network: config.network.id,
          verify: true
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Presale deployment failed';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.details || 'Presale deployment failed';
        } catch (e) {
          // If we can't parse the JSON, use the status text
          errorMessage = `Presale deployment failed: ${response.status} ${response.statusText}`;
        }
        throw new AppError(errorMessage, ErrorType.SERVER);
      }

      const result = await response.json();

      return {
        contractAddress: result.contractAddress,
        transactionHash: result.transactionHash,
        network: config.network,
        explorerUrl: `${config.network.explorerUrl}/address/${result.contractAddress}`,
        gasUsed: result.gasUsed,
        deploymentCost: result.deploymentCost,
        salePageUrl: result.salePageUrl
      };
    } catch (error) {
      console.error('Error deploying presale contract:', error);
      if (error instanceof AppError) {
        throw error;
      } else {
        throw new AppError(
          (error as Error).message || 'Presale deployment failed',
          ErrorType.UNKNOWN,
          error
        );
      }
    }
  }

  async getDeployedTokens(): Promise<any[]> {
    try {
      const response = await fetch(`${this.apiUrl}/api/contracts/deployed`, {
        headers: this.getAuthHeaders(),
        // Add a cache-busting parameter to avoid stale data
        cache: 'no-cache'
      });

      if (!response.ok) {
        console.error(`Failed to fetch deployed contracts: ${response.status} ${response.statusText}`);
        return [];
      }

      const data = await response.json();
      
      // Filter tokens based on current mode
      const tokens = data.tokens || [];
      return this.isTestnetMode ? tokens.filter((t: any) => t.network?.id?.includes('testnet')) : tokens.filter((t: any) => !t.network?.id?.includes('testnet'));
    } catch (error) {
      console.error('Error fetching deployed tokens:', error);
      reportError(new AppError('Failed to fetch deployed tokens', ErrorType.SERVER, error));
      return [];
    }
  }

  async getDeployedPresales(): Promise<any[]> {
    try {
      const response = await fetch(`${this.apiUrl}/api/contracts/deployed`, {
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        console.error(`Failed to fetch deployed presales: ${response.status} ${response.statusText}`);
        return [];
      }

      const data = await response.json();
      
      // Filter presales based on current mode
      const presales = data.presales || [];
      return this.isTestnetMode ? presales.filter((p: any) => p.network?.id?.includes('testnet')) : presales.filter((p: any) => !p.network?.id?.includes('testnet'));
    } catch (error) {
      console.error('Error fetching deployed presales:', error);
      reportError(new AppError('Failed to fetch deployed presales', ErrorType.SERVER, error));
      return [];
    }
  }

  async getPublicPresales(): Promise<any[]> {
    try {
      const response = await fetch(`${this.apiUrl}/api/contracts/presales/public`);

      if (!response.ok) {
        console.error(`Failed to fetch public presales: ${response.status} ${response.statusText}`);
        return [];
      }

      const data = await response.json();
      
      // Filter presales based on current mode
      const presales = data || [];
      return this.isTestnetMode ? presales.filter((p: any) => p.network?.id?.includes('testnet')) : presales.filter((p: any) => !p.network?.id?.includes('testnet'));
    } catch (error) {
      console.error('Error fetching public presales:', error);
      reportError(new AppError('Failed to fetch public presales', ErrorType.SERVER, error));
      return [];
    }
  }

  async checkESRBalance(address: string): Promise<number> {
    try {
      const response = await fetch(`${this.apiUrl}/api/auth/esr/balance/${address}`, {
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new AppError(
          errorData.error || 'Failed to fetch ESR balance',
          ErrorType.SERVER,
          errorData
        );
      }

      const data = await response.json();
      return data.balance || 0;
    } catch (error) {
      console.error('Error fetching ESR balance:', error);
      if (error instanceof AppError) {
        throw error;
      } else {
        throw new AppError('Failed to check ESR balance', ErrorType.SERVER, error);
      }
    }
  }

  async deductESRTokens(amount: number = 100): Promise<boolean> {
    try {
      // Get the current wallet address
      const address = await web3Service.getSigner()?.getAddress();
      if (!address) {
        throw new AppError('Wallet not connected', ErrorType.WALLET);
      }
      
      // First, check if we have enough ESR tokens
      const balance = await this.checkESRBalance(address);
      if (balance < amount) {
        throw new AppError(`Insufficient ESR tokens. Required: ${amount}, Available: ${balance.toFixed(2)}`, ErrorType.VALIDATION);
      }
      
      // Use web3Service to transfer ESR tokens to platform wallet
      const txHash = await web3Service.transferToken(
        import.meta.env.VITE_ESR_TOKEN_ADDRESS || '0x742d35Cc6634C0532925a3b8D4C9db96590c6C8C',
        import.meta.env.VITE_PLATFORM_WALLET || '0x742d35Cc6634C0532925a3b8D4C9db96590c6C8C',
        amount
      );
      
      // Notify backend about the transaction
      const response = await fetch(`${this.apiUrl}/api/auth/esr/deduct`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({ amount, txHash }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new AppError(
          errorData.error || 'Failed to deduct ESR tokens',
          ErrorType.SERVER,
          errorData
        );
      }

      const data = await response.json();
      return data.success || false;
    } catch (error) {
      console.error('Error deducting ESR tokens:', error);
      if (error instanceof AppError) {
        throw error;
      } else {
        throw new AppError('Failed to deduct ESR tokens', ErrorType.SERVER, error);
      }
    }
  }

  // Real data fetching methods
  async getTokenStatistics(contractAddress: string, network: Network): Promise<{
    holders: number;
    transfers: number;
    totalSupply: string;
    lastUpdated: string;
  }> {
    try {
      const response = await fetch(`${this.apiUrl}/api/contracts/${contractAddress}/stats?network=${network.id}`, {
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new AppError(
          errorData.error || 'Failed to fetch token statistics',
          ErrorType.SERVER,
          errorData
        );
      }

      const data = await response.json();
      
      // If there's an error in the response, log it and return defaults
      if (data.error) {
        console.error(`Error in token statistics response: ${data.error}`);
        reportError(new AppError(data.error, ErrorType.SERVER, data.details));
      }
      
      return {
        holders: data.holders || 0,
        transfers: data.transfers || 0,
        totalSupply: data.totalSupply || '0',
        lastUpdated: data.lastUpdated || new Date().toISOString()
      };
    } catch (error) {
      console.error('Error fetching token statistics:', error);
      const appError = new AppError('Failed to fetch token statistics', ErrorType.SERVER, error);
      reportError(appError);
      
      // Retry once after a short delay
      try {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const response = await fetch(`${this.apiUrl}/api/contracts/${contractAddress}/stats?network=${network.id}`, {
          headers: this.getAuthHeaders(),
          cache: 'no-store'
        });
        
        if (response.ok) {
          const data = await response.json();
          return {
            holders: data.holders || 0,
            transfers: data.transfers || 0,
            totalSupply: data.totalSupply || '0',
            lastUpdated: data.lastUpdated || new Date().toISOString()
          };
        }
      } catch (retryError) {
        console.error('Retry failed:', retryError);
      }
      
      return { 
        holders: 0, 
        transfers: 0, 
        totalSupply: '0',
        lastUpdated: new Date().toISOString()
      };
    }
  }

  async getSaleStatistics(contractAddress: string): Promise<{
    totalRaised: string;
    participantCount: number;
    status: 'upcoming' | 'live' | 'ended';
  }> {
    try {
      // Get current network from web3Service
      const network = await web3Service.getCurrentNetwork();
      const networkId = network?.id || 'ethereum';
      
      const response = await fetch(`${this.apiUrl}/api/contracts/presale/${contractAddress}/stats?network=${networkId}`, {
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new AppError(
          errorData.error || 'Failed to fetch sale statistics',
          ErrorType.SERVER,
          errorData
        );
      }

      const data = await response.json();
      
      // If there's an error in the response, log it
      if (data.error) {
        console.error(`Error in sale statistics response: ${data.error}`);
        reportError(new AppError(data.error, ErrorType.SERVER, data.details));
      }
      
      return {
        totalRaised: data.totalRaised || '0',
        participantCount: data.participantCount || 0,
        status: data.status || 'upcoming'
      };
    } catch (error) {
      console.error('Error fetching sale statistics:', error);
      reportError(new AppError('Failed to fetch sale statistics', ErrorType.SERVER, error));
      return { totalRaised: '0', participantCount: 0, status: 'upcoming' };
    }
  }
}

export const contractService = new ContractService();