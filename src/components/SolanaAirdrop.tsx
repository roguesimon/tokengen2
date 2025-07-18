import React, { useState, useCallback, useEffect } from 'react';
import { 
  Send, 
  Upload, 
  AlertTriangle, 
  CheckCircle, 
  Loader2, 
  ArrowLeft, 
  Plus, 
  Trash2, 
  Download,
  Copy,
  FileText
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import Papa from 'papaparse';
import { saveAs } from 'file-saver';
import { PublicKey } from '@solana/web3.js';
import { useSolanaWallet } from '../hooks/useSolanaWallet';
import { solanaService } from '../services/solanaService';
import { SolanaAirdropRecipient } from '../types/solana';

export const SolanaAirdrop: React.FC = () => {
  const { isConnected, publicKey, network } = useSolanaWallet();
  const [tokenAddress, setTokenAddress] = useState('');
  const [tokenInfo, setTokenInfo] = useState<{
    name: string;
    symbol: string;
    decimals: number;
    balance: string;
  } | null>(null);
  const [recipients, setRecipients] = useState<SolanaAirdropRecipient[]>([
    { address: '', amount: '', valid: false }
  ]);
  const [isValidating, setIsValidating] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [totalAmount, setTotalAmount] = useState('0');
  const [txSignature, setTxSignature] = useState<string | null>(null);

  useEffect(() => {
    if (tokenAddress && isValidSolanaAddress(tokenAddress)) {
      loadTokenInfo();
    } else {
      setTokenInfo(null);
    }
  }, [tokenAddress, publicKey]);

  useEffect(() => {
    calculateTotalAmount();
  }, [recipients]);

  const loadTokenInfo = async () => {
    if (!isConnected || !publicKey || !tokenAddress) return;
    
    setIsValidating(true);
    setError(null);
    
    try {
      // In a real implementation, you would:
      // 1. Get token info from solanaService
      // 2. Get token balance for the connected wallet
      
      // For this demo, we'll use mock data
      setTokenInfo({
        name: 'Demo Token',
        symbol: 'DEMO',
        decimals: 9,
        balance: '1000000'
      });
    } catch (error) {
      console.error('Error loading token info:', error);
      setError('Failed to load token information. Please check the token address.');
      setTokenInfo(null);
    } finally {
      setIsValidating(false);
    }
  };

  const calculateTotalAmount = () => {
    const total = recipients.reduce((sum, recipient) => {
      const amount = parseFloat(recipient.amount) || 0;
      return sum + amount;
    }, 0);
    
    setTotalAmount(total.toString());
  };

  const handleAddRecipient = () => {
    setRecipients([...recipients, { address: '', amount: '', valid: false }]);
  };

  const handleRemoveRecipient = (index: number) => {
    const newRecipients = [...recipients];
    newRecipients.splice(index, 1);
    setRecipients(newRecipients);
  };

  const handleRecipientChange = (index: number, field: 'address' | 'amount', value: string) => {
    const newRecipients = [...recipients];
    newRecipients[index][field] = value;
    
    // Validate recipient
    if (field === 'address') {
      newRecipients[index].valid = isValidSolanaAddress(value);
      if (!newRecipients[index].valid) {
        newRecipients[index].error = 'Invalid Solana address';
      } else {
        delete newRecipients[index].error;
      }
    } else if (field === 'amount') {
      const amount = parseFloat(value);
      newRecipients[index].valid = !isNaN(amount) && amount > 0;
      if (!newRecipients[index].valid) {
        newRecipients[index].error = 'Invalid amount';
      } else {
        delete newRecipients[index].error;
      }
    }
    
    setRecipients(newRecipients);
  };

  const isValidSolanaAddress = (address: string): boolean => {
    try {
      new PublicKey(address);
      return true;
    } catch (error) {
      return false;
    }
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    
    const file = acceptedFiles[0];
    const reader = new FileReader();
    
    reader.onload = () => {
      try {
        const csvData = reader.result as string;
        const results = Papa.parse(csvData, {
          skipEmptyLines: true
        });
        
        const newRecipients: SolanaAirdropRecipient[] = results.data.map((record: any) => {
          const address = record[0]?.trim();
          const amount = record[1]?.toString().trim();
          
          const isValidAddress = isValidSolanaAddress(address);
          const isValidAmount = !isNaN(parseFloat(amount)) && parseFloat(amount) > 0;
          
          return {
            address,
            amount,
            valid: isValidAddress && isValidAmount,
            error: !isValidAddress 
              ? 'Invalid address' 
              : !isValidAmount 
              ? 'Invalid amount' 
              : undefined
          };
        });
        
        setRecipients(newRecipients);
      } catch (error) {
        console.error('Error parsing CSV:', error);
        setError('Failed to parse CSV file. Please check the format.');
      }
    };
    
    reader.readAsText(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv']
    },
    maxFiles: 1
  });

  const downloadTemplate = () => {
    const csvContent = "GgE7m5Gu4TKTJ2VeJHcZ4RYMgALAGNg4Xmz5XvQPKQeH,100\nHxhWkTg19GxWZZnAoajZMJBmk8BnKnjE5JCqjfLboSV5,200\n9PgAXUS1XJLiYoYT6e93JwNTjytRxzX9GQPTgkYzPjHB,300";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    saveAs(blob, 'solana_airdrop_template.csv');
  };

  const handleSendAirdrop = async () => {
    if (!isConnected || !publicKey || !tokenAddress || !tokenInfo) return;
    
    // Validate recipients 
    const validRecipients = recipients.filter(r => r.valid);
    if (validRecipients.length === 0) {
      setError('No valid recipients found');
      return;
    }
    
    setIsSending(true);
    setError(null);
    setSuccess(null);
    setTxSignature(null);
    
    try {
      // Prepare recipient data
      const formattedRecipients = validRecipients.map(r => ({
        address: r.address,
        amount: parseFloat(r.amount)
      }));
      
      // Call API to perform airdrop
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/solana/airdrop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: JSON.stringify({
          mintAddress: tokenAddress,
          recipients: formattedRecipients
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send airdrop');
      }
      
      const result = await response.json();
      setTxSignature(result.signature);
      setSuccess(`Successfully sent tokens to ${result.recipientCount} recipients!`);
      
      // Clear form
      setRecipients([{ address: '', amount: '', valid: false }]);
    } catch (error) {
      console.error('Error sending airdrop:', error);
      setError((error as Error).message || 'Failed to send airdrop');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => window.location.href = '/solana'}
            className="flex items-center space-x-2 text-gray-300 hover:text-white transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Solana Dashboard</span>
          </button>
          <h1 className="text-3xl font-bold text-white mb-2">Solana Token Airdrop</h1>
          <p className="text-gray-300">Send SPL tokens to multiple addresses in a single transaction</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Token Selection */}
            <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
              <h2 className="text-xl font-semibold text-white mb-4">Select Token</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Token Mint Address
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="text"
                      value={tokenAddress}
                      onChange={(e) => setTokenAddress(e.target.value)}
                      className="flex-1 bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Enter SPL token mint address"
                    />
                    <button
                      onClick={loadTokenInfo}
                      disabled={!tokenAddress || isValidating}
                      className="px-4 py-3 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors text-sm disabled:opacity-50"
                    >
                      {isValidating ? 'Loading...' : 'Load'}
                    </button>
                  </div>
                </div>
                
                {tokenInfo && (
                  <div className="bg-blue-500/20 rounded-lg p-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm text-gray-300">Token Name</div>
                        <div className="text-white font-medium">{tokenInfo.name}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-300">Symbol</div>
                        <div className="text-white font-medium">{tokenInfo.symbol}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-300">Decimals</div>
                        <div className="text-white font-medium">{tokenInfo.decimals}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-300">Your Balance</div>
                        <div className="text-white font-medium">
                          {tokenInfo ? parseFloat(tokenInfo.balance).toLocaleString() : '0'} {tokenInfo?.symbol || ''}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Recipients */}
            <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-white">Recipients</h2>
                
                <div className="flex space-x-2">
                  <button
                    onClick={downloadTemplate}
                    className="px-3 py-1 bg-white/10 text-gray-300 rounded-lg hover:bg-white/20 transition-colors text-sm flex items-center space-x-1"
                  >
                    <Download className="w-3 h-3" />
                    <span>Template</span>
                  </button>
                  <button
                    onClick={handleAddRecipient}
                    className="px-3 py-1 bg-blue-500/20 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-colors text-sm flex items-center space-x-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add</span>
                  </button>
                </div>
              </div>
              
              {/* CSV Upload */}
              <div 
                {...getRootProps()} 
                className={`border-2 border-dashed rounded-lg p-6 mb-6 text-center cursor-pointer transition-colors ${
                  isDragActive 
                    ? 'border-blue-500 bg-blue-500/10' 
                    : 'border-white/20 hover:border-white/40'
                }`}
              >
                <input {...getInputProps()} />
                <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-300">
                  {isDragActive
                    ? 'Drop the CSV file here...'
                    : 'Drag & drop a CSV file, or click to select'}
                </p>
                <p className="text-gray-400 text-sm mt-2">
                  Format: address,amount (one per line)
                </p>
              </div>
              
              {/* Manual Entry */}
              <div className="space-y-3">
                {recipients.map((recipient, index) => (
                  <div key={index} className="flex space-x-2">
                    <input
                      type="text"
                      value={recipient.address}
                      onChange={(e) => handleRecipientChange(index, 'address', e.target.value)}
                      className={`flex-1 bg-white/10 border rounded-lg px-3 py-2 text-white text-sm ${
                        recipient.address && !recipient.valid && recipient.error?.includes('address')
                          ? 'border-red-500/50'
                          : 'border-white/20'
                      }`}
                      placeholder="Recipient Address"
                    />
                    <input
                      type="text"
                      value={recipient.amount}
                      onChange={(e) => handleRecipientChange(index, 'amount', e.target.value)}
                      className={`w-32 bg-white/10 border rounded-lg px-3 py-2 text-white text-sm ${
                        recipient.amount && !recipient.valid && recipient.error?.includes('amount')
                          ? 'border-red-500/50'
                          : 'border-white/20'
                      }`}
                      placeholder="Amount"
                    />
                    <button
                      onClick={() => handleRemoveRecipient(index)}
                      disabled={recipients.length === 1}
                      className="p-2 text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              
              {recipients.some(r => r.address && !r.valid) && (
                <div className="mt-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
                  <div className="flex items-start space-x-3">
                    <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5" />
                    <p className="text-red-400 text-sm">
                      Some recipients have invalid addresses or amounts. Please fix them before proceeding.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Airdrop Summary */}
            <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10 sticky top-6">
              <h3 className="text-lg font-semibold text-white mb-4">Airdrop Summary</h3>
              
              <div className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-gray-300">Token</span>
                  <span className="text-white font-medium">
                    {tokenInfo ? tokenInfo.symbol : '-'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">Recipients</span>
                  <span className="text-white font-medium">
                    {recipients.filter(r => r.valid).length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">Total Amount</span>
                  <span className="text-white font-medium">
                    {parseFloat(totalAmount || '0').toLocaleString()} {tokenInfo?.symbol || ''}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-300">Network</span>
                  <span className="text-white font-medium">
                    {network?.name || 'Unknown'}
                  </span>
                </div>
                
                <div className="border-t border-white/20 pt-4">
                  <button
                    onClick={handleSendAirdrop}
                    disabled={
                      isSending || 
                      !tokenInfo || 
                      recipients.filter(r => r.valid).length === 0 ||
                      parseFloat(totalAmount) <= 0 ||
                      parseFloat(totalAmount) > parseFloat(tokenInfo?.balance || '0')
                    }
                    className="w-full bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 text-white py-3 rounded-lg font-medium transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50"
                  >
                    {isSending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Sending...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        <span>Send Airdrop</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
              
              {error && (
                <div className="mt-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg">
                  <div className="flex items-start space-x-3">
                    <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5" />
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                </div>
              )}
              
              {success && (
                <div className="mt-4 p-3 bg-green-500/20 border border-green-500/50 rounded-lg">
                  <div className="flex items-start space-x-3">
                    <CheckCircle className="w-5 h-5 text-green-400 mt-0.5" />
                    <div>
                      <p className="text-green-400 text-sm">{success}</p>
                      {txSignature && (
                        <div className="flex items-center mt-2 space-x-2">
                          <code className="text-xs text-green-300 font-mono bg-green-500/10 px-2 py-1 rounded">
                            {txSignature.slice(0, 10)}...{txSignature.slice(-8)}
                          </code>
                          <button
                            onClick={() => copyToClipboard(txSignature, 'signature')}
                            className="p-1 text-green-400 hover:text-green-300 transition-colors"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          {copied === 'signature' && (
                            <span className="text-green-400 text-xs">Copied!</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Instructions */}
            <div className="bg-white/5 backdrop-blur-sm rounded-xl p-6 border border-white/10">
              <h3 className="text-lg font-semibold text-white mb-4">Instructions</h3>
              
              <ol className="space-y-3 text-gray-300 text-sm list-decimal list-inside">
                <li>Enter the SPL token mint address</li>
                <li>Add recipient addresses and amounts manually or upload a CSV file</li>
                <li>Review the summary and send the airdrop</li>
              </ol>
              
              <div className="mt-4 p-3 bg-blue-500/20 border border-blue-500/50 rounded-lg">
                <p className="text-blue-300 text-sm">
                  <strong>Tip:</strong> Using the batch sender saves transaction fees compared to individual transfers. 
                  The larger the batch, the more cost-efficient it becomes.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};