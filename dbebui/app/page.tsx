import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/navbar";

export default function Home() {
    return (
        <div className="flex min-h-screen flex-col bg-background text-foreground">
            <Navbar />

            <main className="flex-1 flex flex-col items-center justify-center px-6 text-center">
                <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight mb-6">
                    Your AI Assistant for <br className="hidden sm:block" />
                    <span className="text-blue-600 dark:text-blue-400">
                        Doing Business
                    </span>
                </h1>
                <p className="max-w-2xl text-lg sm:text-xl text-zinc-600 dark:text-zinc-400 mb-10">
                    Access instant insights, summaries, and answers from the Doing Business
                    database. Powered by advanced RAG technology.
                </p>

                <div className="flex flex-col sm:flex-row gap-4">
                    <Button asChild size="lg" className="h-12 px-8 text-base">
                        <Link href="/chat">Start Chatting</Link>
                    </Button>
                    <Button
                        asChild
                        variant="outline"
                        size="lg"
                        className="h-12 px-8 text-base"
                    >
                        <Link href="https://github.com/your-repo" target="_blank">
                            Learn More
                        </Link>
                    </Button>
                </div>
            </main>

            <footer className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                &copy; {new Date().getFullYear()} DBEB RAG. All rights reserved.
            </footer>
        </div>
    );
}
