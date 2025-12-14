"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/navbar";

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatPage() {
    const [threadId, setThreadId] = useState<string | null>(null);
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<Array<Msg>>([]);
    const [loading, setLoading] = useState(false);
    const eventSourceRef = useRef<EventSource | null>(null);
    const bottomRef = useRef<HTMLDivElement | null>(null);
    const [suggestions] = useState<string[]>([
        "Summarize this document",
        "Explain key points",
        "Where is X mentioned?",
        "Give me references",
    ]);

    const startStream = (tid: string, text: string) => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        const url = new URL("http://127.0.0.1:8000/stream");
        url.searchParams.set("thread_id", tid);
        url.searchParams.set("text", text);
        const es = new EventSource(url.toString());
        eventSourceRef.current = es;
        es.addEventListener("token", (e) => {
            const data = (e as MessageEvent).data as string;
            setMessages((prev) => {
                const copy = [...prev];
                const idx = copy.length - 1;
                if (idx >= 0 && copy[idx].role === "assistant") {
                    copy[idx] = { role: "assistant", content: copy[idx].content + data };
                }
                return copy;
            });
        });
        es.addEventListener("done", () => {
            setLoading(false);
            es.close();
            eventSourceRef.current = null;
        });
        es.onerror = (e) => {
            console.error("SSE network error", e);
            setLoading(false);
            es.close();
            eventSourceRef.current = null;
        };
        es.addEventListener("sse-error", (e) => {
            const data = (e as MessageEvent).data as string;
            console.error("SSE server error:", data);
            setLoading(false);
            es.close();
            eventSourceRef.current = null;
        });
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
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
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
                                    <div className={`text-[15px] leading-7 whitespace-pre-wrap ${m.role === "user" ? "text-zinc-800 dark:text-zinc-200" : "text-zinc-800 dark:text-zinc-200"}`}>
                                        {m.content}
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
                    <div className={`bg-zinc-100 dark:bg-zinc-800 rounded-3xl flex items-end p-2 transition-shadow ${loading ? 'opacity-80' : 'hover:shadow-md'}`}>
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
