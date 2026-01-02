import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { ReactNode } from "react";
import { Sparkles } from "lucide-react";

interface NavbarProps {
    children?: ReactNode;
    badge?: ReactNode;
}

export function Navbar({ children, badge }: NavbarProps) {
    return (
        <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-background/80 backdrop-blur-md sticky top-0 z-20">
            <div className="flex items-center gap-3">
                <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                    <div className="size-8 rounded-full bg-gradient-to-tr from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center text-white">
                        <Sparkles className="w-4 h-4" />
                    </div>
                    <span className="text-xl font-bold">DBEB Agent</span>
                </Link>
                {badge}
            </div>
            <nav className="flex items-center gap-4">
                {children}
                <ThemeToggle />
            </nav>
        </header>
    );
}
