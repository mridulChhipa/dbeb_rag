"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/navbar";
import { extractText } from "unpdf";
import mammoth from "mammoth";
import ReactMarkdown from "react-markdown";

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatPage() {
    const [threadId, setThreadId] = useState<string | null>(null);
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<Array<Msg>>([]);
    const [loading, setLoading] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);
    const bottomRef = useRef<HTMLDivElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [documentContext, setDocumentContext] = useState<string>("");
    const [uploadedFileName, setUploadedFileName] = useState<string>("");
    const [suggestions] = useState<string[]>([
        "Summarize this document",
        "Explain key points",
        "Where is X mentioned?",
        "Give me references",
    ]);

    // Parse uploaded file based on extension
    const parseFile = async (file: File): Promise<string> => {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

        if (ext === "pdf") {
            const arrayBuffer = await file.arrayBuffer();
            const { text } = await extractText(arrayBuffer);
            return Array.isArray(text) ? text.join("\n").trim() : text;
        } else if (ext === "docx") {
            const arrayBuffer = await file.arrayBuffer();
            const result = await mammoth.extractRawText({ arrayBuffer });
            return result.value.trim();
        } else {
            // Treat all other files as plaintext
            return await file.text();
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const text = await parseFile(file);
            setDocumentContext(text);
            setUploadedFileName(file.name);
        } catch (err) {
            console.error("Failed to parse file:", err);
            alert("Failed to parse file. Please try again.");
        }
        // Reset input so the same file can be selected again
        e.target.value = "";
    };

    const clearDocument = () => {
        setDocumentContext("");
        setUploadedFileName("");
    };

    const startStream = async (tid: string, text: string) => {
        // Abort any existing request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const response = await fetch("http://127.0.0.1:8000/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    thread_id: tid,
                    text,
                    context: documentContext || undefined,
                }),
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
                        if (eventType === "token") {
                            setMessages((prev) => {
                                const copy = [...prev];
                                const idx = copy.length - 1;
                                if (idx >= 0 && copy[idx].role === "assistant") {
                                    copy[idx] = { role: "assistant", content: copy[idx].content + data };
                                }
                                return copy;
                            });
                        } else if (eventType === "done") {
                            setLoading(false);
                        } else if (eventType === "sse-error") {
                            console.error("SSE server error:", data);
                            setLoading(false);
                        }
                    }
                }
            }
            setLoading(false);
        } catch (err) {
            if ((err as Error).name !== "AbortError") {
                console.error("Stream error:", err);
            }
            setLoading(false);
        }
        abortControllerRef.current = null;
    };

    const sendMessage = () => {
        if (!input.trim()) return;
        const text = input.trim();
        setInput("");
        setLoading(true);
        const tid = threadId ?? crypto.randomUUID();
        setThreadId(tid);
        setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "" }]);
        startStream(tid, text);
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

    return (
        <div className="flex flex-col h-screen bg-background text-foreground font-sans">
            <Navbar
                badge={
                    <span className="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-2 py-0.5 rounded-full">
                        Gemini 2.5 Flash
                    </span>
                }
            >
                <div className="text-xs text-zinc-400 dark:text-zinc-500 font-mono">
                    {threadId ? `Session: ${threadId.slice(0, 8)}...` : "New Session"}
                </div>
            </Navbar>

            <main className="flex-1 overflow-y-auto scroll-smooth">
                <div className="max-w-3xl mx-auto px-4 py-8 min-h-full flex flex-col">

                    {messages.length === 0 && (
                        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-8 opacity-0 animate-in fade-in duration-700 fill-mode-forwards" style={{ animationDelay: '0.1s' }}>
                            <div className="space-y-2">
                                <h1 className="text-4xl md:text-5xl font-medium bg-gradient-to-r from-blue-600 via-purple-500 to-red-500 bg-clip-text text-transparent pb-1">
                                    Hello, Human.
                                </h1>
                                <p className="text-xl text-zinc-400 dark:text-zinc-500 font-light">How can I help you with your documents today?</p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl">
                                {suggestions.map((s, i) => (
                                    <button
                                        key={i}
                                        onClick={() => {
                                            setInput(s);
                                            setTimeout(() => sendMessage(), 0);
                                        }}
                                        className="text-left p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700 group"
                                    >
                                        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300 group-hover:text-zinc-900 dark:group-hover:text-zinc-100">{s}</p>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="space-y-8 pb-4">
                        {messages.map((m, i) => (
                            <div key={i} className={`flex gap-4 ${m.role === "user" ? "justify-end" : "justify-start"}`}>

                                {m.role === "assistant" && (
                                    <div className="flex-none size-8 rounded-full bg-gradient-to-tr from-blue-500 to-red-500 flex items-center justify-center text-white shadow-sm mt-1">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a10 10 0 1 0 10 10H12V2z" /><path d="M12 12 2.1 12a10.1 10.1 0 0 0 19.8 0" /></svg>
                                    </div>
                                )}

                                <div className={`max-w-[85%] md:max-w-[75%] ${m.role === "user" ? "bg-zinc-100 dark:bg-zinc-800 rounded-3xl rounded-tr-sm px-5 py-3.5" : "pt-1"}`}>
                                    <div className={`text-[15px] leading-7 ${m.role === "user" ? "text-zinc-800 dark:text-zinc-200 whitespace-pre-wrap" : "text-zinc-800 dark:text-zinc-200 prose prose-zinc dark:prose-invert prose-sm max-w-none"}`}>
                                        {m.role === "assistant" ? (
                                            <ReactMarkdown>{m.content}</ReactMarkdown>
                                        ) : (
                                            m.content
                                        )}
                                        {m.role === "assistant" && m.content === "" && loading && (
                                            <span className="inline-block w-2 h-4 ml-1 bg-zinc-400 animate-pulse rounded" />
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                        <div ref={bottomRef} />
                    </div>
                </div>
            </main>

            <footer className="flex-none bg-background p-4 pb-6">
                <div className="max-w-3xl mx-auto relative">
                    {/* File indicator */}
                    {uploadedFileName && (
                        <div className="mb-2 flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                            </svg>
                            <span className="truncate max-w-xs">{uploadedFileName}</span>
                            <button
                                onClick={clearDocument}
                                className="ml-1 p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                                title="Remove document"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                            </button>
                        </div>
                    )}
                    <div className={`bg-zinc-100 dark:bg-zinc-800 rounded-3xl flex items-end p-2 transition-shadow ${loading ? 'opacity-80' : 'hover:shadow-md'}`}>
                        {/* Hidden file input */}
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileUpload}
                            accept=".pdf,.docx,.txt,.md,.json,.csv,.xml,.html,.js,.ts,.py,.java,.c,.cpp,.h,.css,.yaml,.yml,.toml,.ini,.cfg,.log"
                            className="hidden"
                        />
                        {/* Paperclip button */}
                        <Button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={loading}
                            size="icon"
                            variant="ghost"
                            className="mb-1 ml-1 rounded-full text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                            title="Upload document"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                            </svg>
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
                            placeholder={uploadedFileName ? "Ask about the uploaded document..." : "Ask anything..."}
                            className="flex-1 bg-transparent border-none focus:ring-0 resize-none max-h-32 min-h-[48px] py-3 px-4 text-zinc-800 dark:text-zinc-200 placeholder-zinc-500 dark:placeholder-zinc-400 outline-none"
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
                            disabled={loading || !input.trim()}
                            size="icon"
                            variant="ghost"
                            className="mb-1 mr-1 rounded-full bg-background text-zinc-600 shadow-sm transition-all hover:bg-blue-50 hover:text-blue-600 disabled:opacity-50 disabled:hover:bg-background disabled:hover:text-zinc-400 dark:text-zinc-400 dark:hover:bg-blue-900/20"
                        >
                            {loading ? (
                                <div className="size-5 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600 dark:border-zinc-600" />
                            ) : (
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="20"
                                    height="20"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="m5 12 7-7 7 7" />
                                    <path d="M12 19V5" />
                                </svg>
                            )}
                        </Button>
                    </div>
                    <div className="text-center mt-2">
                        <p className="text-xs text-zinc-400 dark:text-zinc-500">Gemini can make mistakes, so double-check it.</p>
                    </div>
                </div>
            </footer>
        </div>
    );
}
