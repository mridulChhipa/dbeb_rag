import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";

interface NavbarProps {
    children?: ReactNode;
    badge?: ReactNode;
}

export function Navbar({ children, badge }: NavbarProps) {
    return (
        <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-background/80 backdrop-blur-md sticky top-0 z-20">
            <div className="flex items-center gap-2">
                <Link
                    href="/"
                    className="text-xl font-bold hover:opacity-80 transition-opacity"
                >
                    DBEB RAG
                </Link>
                {badge}
            </div>
            <nav className="flex items-center gap-4">
                {children}
                <Button asChild variant="ghost" size="sm">
                    <Link href="/admin/evaluate">Candidate Evaluation</Link>
                </Button>
                <Button asChild variant="ghost" size="icon" title="Admin">
                    <Link href="/admin">
                        <Settings className="h-5 w-5" />
                        <span className="sr-only">Admin</span>
                    </Link>
                </Button>
                <ThemeToggle />
            </nav>
        </header>
    );
}
