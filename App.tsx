
import React, { useState, useEffect } from 'react';
import { gemini } from './services/geminiService';
import { supabase } from './services/supabaseService';
import { Document, ChatMessage } from './types';
import * as pdfjs from 'pdfjs-dist';
import mammoth from 'mammoth';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

const SQL_SETUP = `-- 1. Enable pgvector extension
create extension if not exists vector;

-- 2. Create documents table
create table if not exists documents (
  id text primary key,
  name text not null,
  content text not null,
  metadata jsonb,
  embedding vector(1536) -- Standard dimension for embeddings
);

-- 3. Enable row level security (optional)
alter table documents enable row level security;
create policy "Allow public access" on documents for all using (true);`;

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'upload' | 'chat'>('upload');
  const [documents, setDocuments] = useState<Document[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [isAnswering, setIsAnswering] = useState(false);
  const [showSqlSetup, setShowSqlSetup] = useState(false);
  const [supabaseConfig, setSupabaseConfig] = useState({
    url: localStorage.getItem('sb_url') || '',
    key: localStorage.getItem('sb_key') || ''
  });
  const [isConfigured, setIsConfigured] = useState(false);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  useEffect(() => {
    if (supabaseConfig.url && supabaseConfig.key) {
      try {
        supabase.init(supabaseConfig.url, supabaseConfig.key);
        setIsConfigured(true);
      } catch (e) {
        console.error("Failed to init supabase", e);
      }
    }
  }, [supabaseConfig]);

  const handleConfigSave = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('sb_url', supabaseConfig.url);
    localStorage.setItem('sb_key', supabaseConfig.key);
    supabase.init(supabaseConfig.url, supabaseConfig.key);
    setIsConfigured(true);
    setErrorStatus(null);
  };

  const extractTextFromPdf = async (arrayBuffer: ArrayBuffer): Promise<string> => {
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => item.str).join(' ');
      fullText += pageText + '\n';
    }
    return fullText;
  };

  const extractTextFromDocx = async (arrayBuffer: ArrayBuffer): Promise<string> => {
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  };

  const onFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !isConfigured) return;

    setIsUploading(true);
    setErrorStatus(null);
    const newDoc: Document = {
      id: Math.random().toString(36).substr(2, 9),
      name: file.name,
      content: '',
      status: 'processing',
      timestamp: Date.now(),
    };
    setDocuments(prev => [newDoc, ...prev]);

    try {
      let extractedText = '';
      const arrayBuffer = await file.arrayBuffer();

      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        extractedText = await extractTextFromPdf(arrayBuffer);
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.name.endsWith('.docx')) {
        extractedText = await extractTextFromDocx(arrayBuffer);
      } else {
        const decoder = new TextDecoder();
        extractedText = decoder.decode(arrayBuffer);
      }

      if (!extractedText.trim()) throw new Error("File is empty.");

      const processedContent = await gemini.processFileContent(file.name, extractedText);
      await supabase.storeDocument(newDoc.id, file.name, processedContent);
      
      setDocuments(prev => prev.map(d => 
        d.id === newDoc.id ? { ...d, content: processedContent, status: 'ready' } : d
      ));
    } catch (error: any) {
      console.error("Processing failed:", error);
      const msg = error.message || "Failed to upload.";
      if (msg.includes("PGRST205") || msg.includes("documents")) {
        setErrorStatus("Table 'documents' missing in Supabase. Check Setup SQL.");
      } else {
        setErrorStatus(msg);
      }
      setDocuments(prev => prev.map(d => 
        d.id === newDoc.id ? { ...d, status: 'error' } : d
      ));
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() || isAnswering) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', content: inputMessage };
    setChatMessages(prev => [...prev, userMsg]);
    setInputMessage('');
    setIsAnswering(true);

    try {
      const context = await supabase.searchKnowledgeBase(inputMessage);
      const { text, sources } = await gemini.generateAnswer(inputMessage, context);
      setChatMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: 'assistant', content: text, sources }]);
    } catch (error: any) {
      setChatMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Error: ${error.message || "Could not retrieve knowledge. Ensure your Supabase table 'documents' is created."}`
      }]);
    } finally {
      setIsAnswering(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-gray-100 overflow-hidden font-sans">
      <nav className="bg-gray-800 border-b border-gray-700 p-4 shrink-0">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold">Gemini <span className="text-blue-400">VectorFlow</span></h1>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold">Semantic Knowledge Base</p>
            </div>
          </div>
          <div className="flex items-center space-x-6 text-sm font-medium">
             <div className="flex items-center space-x-2 bg-gray-900/50 px-3 py-1.5 rounded-full border border-gray-700">
               <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
               <span className="text-gray-300">Gemini 3 Pro</span>
             </div>
          </div>
        </div>
      </nav>

      <main className="flex-1 flex overflow-hidden">
        <aside className="w-80 bg-gray-800 border-r border-gray-700 flex flex-col p-6 space-y-8 overflow-y-auto shrink-0">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Database Config</h3>
              <button 
                onClick={() => setShowSqlSetup(!showSqlSetup)}
                className="text-[10px] bg-blue-600/10 text-blue-400 px-2 py-1 rounded hover:bg-blue-600/20 transition-colors"
              >
                {showSqlSetup ? 'Close SQL' : 'Setup SQL'}
              </button>
            </div>

            {showSqlSetup && (
              <div className="mb-4 animate-in slide-in-from-top duration-300">
                <p className="text-[11px] text-gray-400 mb-2">Run this in your Supabase SQL Editor:</p>
                <div className="relative group">
                  <pre className="bg-black/50 p-3 rounded-lg text-[10px] font-mono text-gray-300 overflow-x-auto whitespace-pre-wrap border border-gray-700 max-h-48 overflow-y-auto custom-scrollbar">
                    {SQL_SETUP}
                  </pre>
                  <button 
                    onClick={() => navigator.clipboard.writeText(SQL_SETUP)}
                    className="absolute top-2 right-2 p-1.5 bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                  </button>
                </div>
              </div>
            )}

            {!isConfigured ? (
              <form onSubmit={handleConfigSave} className="space-y-3">
                <input 
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                  placeholder="Supabase Project URL"
                  value={supabaseConfig.url}
                  onChange={(e) => setSupabaseConfig(prev => ({ ...prev, url: e.target.value }))}
                />
                <input 
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
                  type="password"
                  placeholder="Anon API Key"
                  value={supabaseConfig.key}
                  onChange={(e) => setSupabaseConfig(prev => ({ ...prev, key: e.target.value }))}
                />
                <button className="w-full bg-blue-600 hover:bg-blue-700 py-2.5 rounded-lg text-sm font-semibold shadow-lg shadow-blue-900/20 transition-all active:scale-[0.98]">
                  Connect Project
                </button>
              </form>
            ) : (
              <div className="bg-gray-900/50 rounded-lg p-3 border border-green-900/30 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
                  <span className="text-sm font-medium text-green-400">Database Linked</span>
                </div>
                <button onClick={() => setIsConfigured(false)} className="text-[11px] text-gray-500 hover:text-white underline decoration-dotted underline-offset-4">Reset</button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-hidden flex flex-col">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">Indexing Registry</h3>
            <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
              {documents.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-gray-700 rounded-2xl">
                  <p className="text-xs text-gray-600 font-medium">Empty Knowledge Base</p>
                </div>
              ) : (
                documents.map(doc => (
                  <div key={doc.id} className="bg-gray-900/40 border border-gray-700 p-3.5 rounded-xl hover:border-gray-600 transition-colors">
                    <div className="flex items-center space-x-3 mb-2">
                      <div className={`p-1.5 rounded-lg ${doc.status === 'ready' ? 'bg-green-500/10 text-green-500' : doc.status === 'error' ? 'bg-red-500/10 text-red-500' : 'bg-blue-500/10 text-blue-500'}`}>
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </div>
                      <span className="text-sm font-semibold truncate flex-1">{doc.name}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                        doc.status === 'ready' ? 'bg-green-500/20 text-green-500' :
                        doc.status === 'processing' ? 'bg-blue-500/20 text-blue-500 animate-pulse' : 'bg-red-500/20 text-red-500'
                      }`}>
                        {doc.status}
                      </span>
                      <span className="text-[10px] text-gray-500">{new Date(doc.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        <div className="flex-1 flex flex-col bg-gray-900">
          <div className="flex px-4 bg-gray-800/30 border-b border-gray-800 shrink-0">
            <button 
              onClick={() => setActiveTab('upload')}
              className={`px-8 py-4 text-sm font-bold tracking-tight border-b-2 transition-all duration-300 ${activeTab === 'upload' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
            >
              Ingest Documents
            </button>
            <button 
              onClick={() => setActiveTab('chat')}
              className={`px-8 py-4 text-sm font-bold tracking-tight border-b-2 transition-all duration-300 ${activeTab === 'chat' ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
            >
              Knowledge Retrieval
            </button>
          </div>

          <div className="flex-1 overflow-y-auto relative bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-blue-900/10 via-transparent to-transparent">
            {activeTab === 'upload' ? (
              <div className="max-w-3xl mx-auto space-y-12 py-16 px-8">
                <div className="text-center space-y-4">
                  <h2 className="text-4xl font-extrabold tracking-tight">Expand the Engine</h2>
                  <p className="text-gray-400 text-lg max-w-xl mx-auto">Upload documents to trigger the Gemini-Supabase vector pipeline. Text is extracted, cleaned, and stored for near-instant RAG.</p>
                </div>

                {errorStatus && (
                  <div className="bg-red-900/20 border border-red-500/30 p-4 rounded-xl flex items-center space-x-4 animate-in fade-in slide-in-from-bottom-2">
                    <div className="bg-red-500 p-2 rounded-lg text-white">
                       <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-red-400">Operation Error</p>
                      <p className="text-xs text-red-500/80">{errorStatus}</p>
                    </div>
                    <button onClick={() => setErrorStatus(null)} className="ml-auto text-red-400 hover:text-white"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg></button>
                  </div>
                )}

                <div className="relative group">
                  <div className="absolute -inset-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl blur opacity-20 group-hover:opacity-40 transition duration-500"></div>
                  <label className={`relative flex flex-col items-center justify-center w-full h-80 border-2 border-dashed border-gray-700 rounded-3xl bg-gray-800/80 backdrop-blur-sm transition-all shadow-2xl ${!isConfigured || isUploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-800 hover:border-blue-500/50 cursor-pointer'}`}>
                    <div className="flex flex-col items-center justify-center text-center p-12">
                      {isUploading ? (
                        <div className="space-y-6">
                          <div className="relative w-20 h-20 mx-auto">
                            <div className="absolute inset-0 border-4 border-blue-500/20 rounded-full"></div>
                            <div className="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                          </div>
                          <div className="space-y-2">
                            <p className="text-xl font-bold text-blue-400">Analyzing Document</p>
                            <p className="text-sm text-gray-500 animate-pulse">Running Gemini Flash & Vector Injection...</p>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="mb-6 p-6 bg-gray-900 rounded-2xl shadow-inner border border-gray-700 group-hover:border-blue-500/50 transition-colors">
                            <svg className="w-12 h-12 text-gray-500 group-hover:text-blue-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                            </svg>
                          </div>
                          <h3 className="text-2xl font-bold mb-2">Drop Knowledge Source</h3>
                          <p className="text-gray-500 max-w-sm mb-4">Support for PDFs, Word docs, and plain text formats. Maximum index size 10MB.</p>
                          <div className="flex space-x-2">
                            {['PDF', 'DOCX', 'TXT', 'MD'].map(ext => (
                              <span key={ext} className="text-[10px] font-bold px-2 py-1 bg-gray-700 text-gray-400 rounded-md border border-gray-600">{ext}</span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    <input type="file" className="hidden" accept=".pdf,.docx,.txt,.md" onChange={onFileUpload} disabled={!isConfigured || isUploading} />
                  </label>
                </div>
              </div>
            ) : (
              <div className="flex flex-col h-full max-w-4xl mx-auto p-8">
                <div className="flex-1 overflow-y-auto space-y-6 pb-24 custom-scrollbar pr-2">
                  {chatMessages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-6 opacity-30 select-none">
                       <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center border-2 border-gray-700">
                         <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xl font-bold tracking-tight">Neural Search Active</p>
                        <p className="text-sm max-w-xs mx-auto font-medium">Query your knowledge base using natural language. I'll search your vectors and respond using Gemini 3 Pro.</p>
                      </div>
                    </div>
                  ) : (
                    chatMessages.map(msg => (
                      <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-4 duration-300`}>
                        <div className={`max-w-[85%] p-5 rounded-3xl shadow-lg border ${
                          msg.role === 'user' 
                          ? 'bg-blue-600 text-white rounded-tr-none border-blue-500' 
                          : 'bg-gray-800 text-gray-100 border-gray-700 rounded-tl-none'
                        }`}>
                          <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      </div>
                    ))
                  )}
                  {isAnswering && (
                    <div className="flex justify-start">
                      <div className="bg-gray-800 border border-gray-700 px-6 py-4 rounded-3xl rounded-tl-none flex space-x-2">
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce delay-100"></div>
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce delay-200"></div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="absolute bottom-8 left-8 right-8">
                  <form onSubmit={handleSendMessage} className="relative group">
                    <div className="absolute -inset-2 bg-gradient-to-r from-blue-600/30 to-indigo-600/30 rounded-[2rem] blur opacity-0 group-focus-within:opacity-100 transition duration-500"></div>
                    <div className="relative flex items-center bg-gray-800/90 backdrop-blur-md border border-gray-700 rounded-[1.5rem] shadow-2xl overflow-hidden focus-within:border-blue-500/50 transition-all px-2">
                      <input 
                        className="flex-1 bg-transparent px-6 py-5 text-sm focus:outline-none placeholder-gray-500 font-medium"
                        placeholder={isConfigured ? "Query your knowledge base..." : "Configure database to search..."}
                        value={inputMessage}
                        onChange={(e) => setInputMessage(e.target.value)}
                        disabled={!isConfigured || isAnswering}
                      />
                      <button 
                        type="submit"
                        disabled={!inputMessage.trim() || !isConfigured || isAnswering}
                        className="p-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-20 disabled:grayscale text-white rounded-2xl transition-all shadow-lg shadow-blue-900/40 active:scale-95"
                      >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
