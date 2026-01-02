"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sparkles, Plus, X, FileText, Database, Users, MessageSquare } from "lucide-react";
import ReactMarkdown from "react-markdown";

type Msg = { 
    role: "user" | "assistant"; 
    content: string;
    files?: string[];
    intent?: string;
    evaluationResults?: Array<{
        candidate_id: string;
        evaluation?: {
            meets_requirements: boolean;
            reasoning: string;
            missing_criteria?: string[];
            codeforces_rating?: number | null;
        };
        error?: string;
    }>;
};

export default function AgentPage() {
    const [threadId, setThreadId] = useState<string | null>(null);
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<Array<Msg>>([]);
    const [loading, setLoading] = useState(false);
    const [currentIntent, setCurrentIntent] = useState<string | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const bottomRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [isDragging, setIsDragging] = useState(false);

    const suggestions = [
        { icon: MessageSquare, text: "Ask a question", hint: "Chat with the knowledge base" },
        { icon: Database, text: "Ingest this document", hint: "Add to permanent storage" },
        { icon: Users, text: "Evaluate candidates", hint: "Upload CSV + resumes ZIP" },
    ];

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files) return;
        setUploadedFiles(prev => [...prev, ...Array.from(files)]);
        e.target.value = "";
    };

    const removeFile = (index: number) => {
        setUploadedFiles(prev => prev.filter((_, i) => i !== index));
    };

    const clearFiles = () => {
        setUploadedFiles([]);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        
        const droppedFiles = Array.from(e.dataTransfer.files);
        const allowedTypes = ['.pdf', '.docx', '.txt', '.md', '.csv', '.zip', '.json'];
        const validFiles = droppedFiles.filter(file => 
            allowedTypes.some(ext => file.name.toLowerCase().endsWith(ext))
        );
        
        if (validFiles.length > 0) {
            setUploadedFiles(prev => [...prev, ...validFiles]);
        }
    };

    const startAgentStream = async (tid: string, text: string, files: File[]) => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const formData = new FormData();
            formData.append("message", text);
            formData.append("thread_id", tid);
            files.forEach(file => {
                formData.append("files", file);
            });

            const response = await fetch("http://127.0.0.1:8000/agent", {
                method: "POST",
                body: formData,
                signal: controller.signal,
            });

            if (!response.ok || !response.body) {
                throw new Error("Stream failed");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";

                let eventType = "";
                for (const line of lines) {
                    if (line.startsWith("event: ")) {
                        eventType = line.slice(7);
                    } else if (line.startsWith("data: ")) {
                        const data = line.slice(6);
                        
                        if (eventType === "intent") {
                            try {
                                const intentData = JSON.parse(data);
                                setCurrentIntent(intentData.intent);
                                setMessages(prev => {
                                    const copy = [...prev];
                                    const idx = copy.length - 1;
                                    if (idx >= 0 && copy[idx].role === "assistant") {
                                        copy[idx] = { ...copy[idx], intent: intentData.intent };
                                    }
                                    return copy;
                                });
                            } catch {}
                        } else if (eventType === "token") {
                            setMessages(prev => {
                                const copy = [...prev];
                                const idx = copy.length - 1;
                                if (idx >= 0 && copy[idx].role === "assistant") {
                                    copy[idx] = { ...copy[idx], content: copy[idx].content + data };
                                }
                                return copy;
                            });
                        } else if (eventType === "results") {
                            try {
                                const resultsData = JSON.parse(data);
                                const evaluationResults = resultsData.evaluated_candidates;
                                setMessages(prev => {
                                    const copy = [...prev];
                                    const idx = copy.length - 1;
                                    if (idx >= 0 && copy[idx].role === "assistant") {
                                        copy[idx] = { ...copy[idx], evaluationResults };
                                    }
                                    return copy;
                                });
                            } catch {}
                        } else if (eventType === "done") {
                            setLoading(false);
                            setCurrentIntent(null);
                        } else if (eventType === "error" || eventType === "sse-error") {
                            setMessages(prev => {
                                const copy = [...prev];
                                const idx = copy.length - 1;
                                if (idx >= 0 && copy[idx].role === "assistant") {
                                    copy[idx] = { ...copy[idx], content: copy[idx].content + `\n\n❌ Error: ${data}` };
                                }
                                return copy;
                            });
                            setLoading(false);
                            setCurrentIntent(null);
                        }
                    }
                }
            }
            setLoading(false);
            setCurrentIntent(null);
        } catch (err) {
            if ((err as Error).name !== "AbortError") {
                console.error("Stream error:", err);
            }
            setLoading(false);
            setCurrentIntent(null);
        }
        abortControllerRef.current = null;
    };

    const sendMessage = () => {
        if (!input.trim() && uploadedFiles.length === 0) return;
        const text = input.trim() || "Process these files";
        setInput("");
        setLoading(true);
        const tid = threadId ?? crypto.randomUUID();
        setThreadId(tid);
        
        const fileNames = uploadedFiles.map(f => f.name);
        setMessages(prev => [
            ...prev, 
            { role: "user", content: text, files: fileNames },
            { role: "assistant", content: "" }
        ]);
        
        startAgentStream(tid, text, uploadedFiles);
        clearFiles();
    };

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    useEffect(() => {
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, []);

    const getIntentBadge = (intent?: string) => {
        if (!intent) return null;
        const config: Record<string, { icon: typeof MessageSquare; color: string; label: string }> = {
            chat: { icon: MessageSquare, color: "text-blue-500 bg-blue-50 dark:bg-blue-900/20", label: "Chat" },
            ingest: { icon: Database, color: "text-green-500 bg-green-50 dark:bg-green-900/20", label: "Ingesting" },
            evaluate: { icon: Users, color: "text-purple-500 bg-purple-50 dark:bg-purple-900/20", label: "Evaluating" },
        };
        const c = config[intent] || config.chat;
        const Icon = c.icon;
        return (
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${c.color}`}>
                <Icon className="w-3 h-3" />
                {c.label}
            </span>
        );
    };

    return (
        <div className="flex flex-col h-screen bg-background text-foreground font-sans">
            {/* Minimal Header */}
            <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-background/80 backdrop-blur-md sticky top-0 z-20">
                <div className="flex items-center gap-3">
                    <div className="size-8 rounded-full bg-gradient-to-tr from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center text-white">
                        <Sparkles className="w-4 h-4" />
                    </div>
                    <span className="text-xl font-bold">DBEB Agent</span>
                    <span className="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full">
                        AI-Powered
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    {threadId && (
                        <span className="text-xs text-zinc-400 dark:text-zinc-500 font-mono">
                            {threadId.slice(0, 8)}...
                        </span>
                    )}
                    <ThemeToggle />
                </div>
            </header>

            <main className="flex-1 overflow-y-auto scroll-smooth">
                <div className="max-w-3xl mx-auto px-4 py-8 min-h-full flex flex-col">
                    {/* Welcome screen */}
                    {messages.length === 0 && (
                        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-8">
                            <div className="space-y-3">
                                <div className="flex items-center justify-center gap-2 text-2xl font-medium text-zinc-800 dark:text-zinc-200">
                                    <Sparkles className="w-6 h-6 text-blue-500" />
                                    <span>Hi there</span>
                                </div>
                                <h1 className="text-4xl md:text-5xl font-semibold text-zinc-900 dark:text-zinc-100 tracking-tight">
                                    What would you like to do?
                                </h1>
                                <p className="text-base text-zinc-500 dark:text-zinc-400 max-w-lg mx-auto">
                                    I can answer questions, ingest documents to the knowledge base, or evaluate candidates. Just tell me what you need.
                                </p>
                            </div>

                            {/* Unified Input */}
                            <div className="w-full max-w-2xl space-y-3">
                                {/* File chips */}
                                {uploadedFiles.length > 0 && (
                                    <div className="flex flex-wrap gap-2">
                                        {uploadedFiles.map((file, idx) => (
                                            <div key={idx} className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full text-sm">
                                                <FileText className="w-3.5 h-3.5 text-zinc-500" />
                                                <span className="text-zinc-700 dark:text-zinc-300 max-w-[150px] truncate">{file.name}</span>
                                                <button onClick={() => removeFile(idx)} className="p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full">
                                                    <X className="w-3 h-3 text-zinc-500" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                
                                <div 
                                    className={`relative flex items-center w-full p-3 bg-zinc-100 dark:bg-zinc-800 rounded-[2rem] shadow-sm border-2 transition-all ${
                                        isDragging 
                                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                                            : 'border-transparent focus-within:border-zinc-300 dark:focus-within:border-zinc-700'
                                    }`}
                                    onDragOver={handleDragOver}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                >
                                    <input
                                        type="file"
                                        ref={fileInputRef}
                                        onChange={handleFileSelect}
                                        multiple
                                        accept=".pdf,.docx,.txt,.md,.csv,.zip,.json"
                                        className="hidden"
                                    />
                                    <Button
                                        onClick={() => fileInputRef.current?.click()}
                                        variant="ghost"
                                        size="icon"
                                        className="rounded-full text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                    >
                                        <Plus className="w-5 h-5" />
                                    </Button>
                                    <input
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                                        placeholder="Ask anything, or drop files to get started..."
                                        className="flex-1 bg-transparent border-none focus:ring-0 px-4 text-lg text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-500 outline-none"
                                        autoFocus
                                    />
                                    <Button
                                        onClick={sendMessage}
                                        disabled={!input.trim() && uploadedFiles.length === 0}
                                        size="icon"
                                        className="rounded-full bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:opacity-90 disabled:opacity-50"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="m5 12 7-7 7 7" />
                                            <path d="M12 19V5" />
                                        </svg>
                                    </Button>
                                </div>
                            </div>

                            {/* Suggestion cards */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-3xl">
                                {suggestions.map((s, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setInput(s.text)}
                                        className="text-left p-5 rounded-2xl bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 transition-all hover:shadow-md group"
                                    >
                                        <s.icon className="w-6 h-6 text-blue-500 mb-3" />
                                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{s.text}</p>
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{s.hint}</p>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Messages */}
                    <div className="space-y-8 pb-4">
                        {messages.map((m, i) => (
                            <div key={i} className={`flex gap-4 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                                {m.role === "assistant" && (
                                    <div className={`flex-none size-8 rounded-full bg-gradient-to-tr from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center text-white shadow-sm mt-1 ${m.content === "" && loading ? "hidden" : ""}`}>
                                        <Sparkles className="w-4 h-4" />
                                    </div>
                                )}

                                <div className={`max-w-[85%] md:max-w-[75%] ${m.role === "user" ? "" : "pt-1"}`}>
                                    {/* User message with files */}
                                    {m.role === "user" && (
                                        <div className="space-y-2">
                                            {m.files && m.files.length > 0 && (
                                                <div className="flex flex-wrap gap-1.5 justify-end">
                                                    {m.files.map((fname, fi) => (
                                                        <span key={fi} className="inline-flex items-center gap-1 px-2 py-1 bg-zinc-200 dark:bg-zinc-700 rounded-lg text-xs text-zinc-600 dark:text-zinc-300">
                                                            <FileText className="w-3 h-3" />
                                                            {fname}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            <div className="bg-zinc-100 dark:bg-zinc-800 rounded-3xl rounded-tr-sm px-5 py-3.5">
                                                <p className="text-[15px] leading-7 text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap">
                                                    {m.content}
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Assistant message */}
                                    {m.role === "assistant" && (
                                        <div className="space-y-3">
                                            {m.intent && (
                                                <div>{getIntentBadge(m.intent)}</div>
                                            )}
                                            <div className="text-[15px] leading-7 text-zinc-800 dark:text-zinc-200 prose prose-zinc dark:prose-invert prose-sm max-w-none">
                                                <ReactMarkdown>{m.content}</ReactMarkdown>
                                                
                                                {/* Loading indicator */}
                                                {m.content === "" && loading && (
                                                    <div className="py-2">
                                                        <div className="relative flex items-center justify-center w-10 h-10">
                                                            <svg className="absolute inset-0 w-10 h-10" viewBox="0 0 40 40">
                                                                <defs>
                                                                    <linearGradient id="arc-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                                                        <stop offset="0%" stopColor="#3b82f6" />
                                                                        <stop offset="50%" stopColor="#a855f7" />
                                                                        <stop offset="100%" stopColor="#ec4899" />
                                                                    </linearGradient>
                                                                </defs>
                                                                <circle cx="20" cy="20" r="16" fill="none" stroke="url(#arc-gradient)" strokeWidth="2.5" strokeLinecap="round" className="animate-arc-pulse" />
                                                            </svg>
                                                            <div className="animate-spin-slow">
                                                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="url(#gemini-inner-gradient)">
                                                                    <defs>
                                                                        <linearGradient id="gemini-inner-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                                                                            <stop offset="0%" stopColor="#3b82f6" />
                                                                            <stop offset="50%" stopColor="#a855f7" />
                                                                            <stop offset="100%" stopColor="#ec4899" />
                                                                        </linearGradient>
                                                                    </defs>
                                                                    <path d="M12 2L15.09 8.91L22 12L15.09 15.09L12 22L8.91 15.09L2 12L8.91 8.91L12 2Z" />
                                                                </svg>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Evaluation Results Cards */}
                                            {m.evaluationResults && m.evaluationResults.length > 0 && (
                                                <div className="space-y-3 mt-4">
                                                    <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Detailed Results</h4>
                                                    <div className="grid gap-3">
                                                        {m.evaluationResults.map((result, ri) => (
                                                            <div key={ri} className="rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 bg-white dark:bg-zinc-900">
                                                                <div className="flex items-start justify-between gap-2">
                                                                    <p className="font-medium text-zinc-900 dark:text-zinc-100">{result.candidate_id}</p>
                                                                    {result.error ? (
                                                                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400">Error</span>
                                                                    ) : result.evaluation?.meets_requirements ? (
                                                                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400">Qualified</span>
                                                                    ) : (
                                                                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400">Not Qualified</span>
                                                                    )}
                                                                </div>
                                                                {result.error ? (
                                                                    <p className="text-sm text-red-600 dark:text-red-400 mt-2">{result.error}</p>
                                                                ) : (
                                                                    <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-2">{result.evaluation?.reasoning}</p>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        <div ref={bottomRef} />
                    </div>
                </div>
            </main>

            {/* Footer input (only when in conversation) */}
            {messages.length > 0 && (
                <footer className="flex-none bg-background p-4 pb-6 border-t border-zinc-100 dark:border-zinc-900">
                    <div className="max-w-3xl mx-auto space-y-3">
                        {/* File chips */}
                        {uploadedFiles.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {uploadedFiles.map((file, idx) => (
                                    <div key={idx} className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full text-sm">
                                        <FileText className="w-3.5 h-3.5 text-zinc-500" />
                                        <span className="text-zinc-700 dark:text-zinc-300 max-w-[150px] truncate">{file.name}</span>
                                        <button onClick={() => removeFile(idx)} className="p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-full">
                                            <X className="w-3 h-3 text-zinc-500" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div 
                            className={`bg-zinc-100 dark:bg-zinc-800 rounded-3xl flex items-end p-2 transition-all border-2 ${
                                isDragging 
                                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                                    : 'border-transparent'
                            } ${loading ? 'opacity-80' : 'hover:shadow-md'}`}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                        >
                            <input type="file" ref={fileInputRef} onChange={handleFileSelect} multiple accept=".pdf,.docx,.txt,.md,.csv,.zip,.json" className="hidden" />
                            <Button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={loading}
                                size="icon"
                                variant="ghost"
                                className="mb-1 ml-1 rounded-full text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                            >
                                <Plus className="w-5 h-5" />
                            </Button>
                            <textarea
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        sendMessage();
                                    }
                                }}
                                placeholder="Ask anything..."
                                disabled={loading}
                                className="flex-1 bg-transparent border-none focus:ring-0 resize-none max-h-32 min-h-[48px] py-3 px-4 text-zinc-800 dark:text-zinc-200 placeholder-zinc-500 dark:placeholder-zinc-400 outline-none disabled:opacity-50"
                                rows={1}
                                style={{ height: 'auto', overflow: 'hidden' }}
                                onInput={(e) => {
                                    const target = e.target as HTMLTextAreaElement;
                                    target.style.height = 'auto';
                                    target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
                                }}
                            />
                            <Button
                                onClick={sendMessage}
                                disabled={loading || (!input.trim() && uploadedFiles.length === 0)}
                                size="icon"
                                className="mb-1 mr-1 rounded-full bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:opacity-90 disabled:opacity-50"
                            >
                                {loading ? (
                                    <div className="size-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="m5 12 7-7 7 7" />
                                        <path d="M12 19V5" />
                                    </svg>
                                )}
                            </Button>
                        </div>
                        <div className="text-center">
                            <p className="text-xs text-zinc-400 dark:text-zinc-500">
                                Upload files + describe your task. The agent will figure out the rest.
                            </p>
                        </div>
                    </div>
                </footer>
            )}
        </div>
    );
}
