"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UploadCloud, FileText, X } from "lucide-react";

export default function AdminPage() {
    const [adminKey, setAdminKey] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
    const [message, setMessage] = useState("");
    const [isDragging, setIsDragging] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [ingestProgress, setIngestProgress] = useState(0);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const droppedFile = e.dataTransfer.files[0];
            if (droppedFile.type === "application/pdf") {
                setFile(droppedFile);
                setMessage("");
                setStatus("idle");
            } else {
                setMessage("Please upload a PDF file.");
                setStatus("error");
            }
        }
    };

    const handleUpload = () => {
        if (!file || !adminKey) {
            setMessage("Please provide both Admin Key and a file.");
            setStatus("error");
            return;
        }

        setStatus("uploading");
        setMessage("");
        setUploadProgress(0);
        setIngestProgress(0);

        const formData = new FormData();
        formData.append("file", file);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "http://127.0.0.1:8000/upload");
        xhr.setRequestHeader("X-Admin-Key", adminKey);

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percentComplete = (event.loaded / event.total) * 100;
                setUploadProgress(percentComplete);
            }
        };

        let lastProcessedIndex = 0;

        xhr.onprogress = () => {
            const response = xhr.responseText;
            const newContent = response.substring(lastProcessedIndex);

            if (!newContent) return;

            const lines = newContent.split("\n\n");

            // We might have a partial line at the end, so we should be careful.
            // But for simplicity, let's assume chunks come in full events or we just parse what we can.
            // A more robust parser would buffer partial lines.

            for (const line of lines) {
                if (line.startsWith("event: progress")) {
                    const dataLine = line.split("\n").find(l => l.startsWith("data: "));
                    if (dataLine) {
                        try {
                            const data = JSON.parse(dataLine.substring(6));
                            if (data.total > 0) {
                                const percent = (data.current / data.total) * 100;
                                setIngestProgress(percent);
                            }
                        } catch (e) {
                            console.error("Error parsing progress data", e);
                        }
                    }
                } else if (line.startsWith("event: done")) {
                    setIngestProgress(100);
                    setStatus("success");
                    setMessage("Upload and ingestion successful!");
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                } else if (line.startsWith("event: error")) {
                    const dataLine = line.split("\n").find(l => l.startsWith("data: "));
                    if (dataLine) {
                        try {
                            const data = JSON.parse(dataLine.substring(6));
                            setMessage(data.detail || "An error occurred");
                        } catch {
                            setMessage("An error occurred");
                        }
                    }
                    setStatus("error");
                }
            }

            lastProcessedIndex = response.length;
        };

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                // Success is handled in onprogress via 'event: done'
                // But if the connection closes without 'done', we might want to check.
            } else {
                try {
                    const errorData = JSON.parse(xhr.responseText);
                    setMessage(errorData.detail || "Upload failed");
                } catch {
                    setMessage("Upload failed");
                }
                setStatus("error");
            }
        };

        xhr.onerror = () => {
            setMessage("Network error occurred.");
            setStatus("error");
        };

        xhr.send(formData);
    };

    return (
        <div className="flex min-h-screen flex-col bg-background text-foreground font-sans">
            <Navbar>
                <div className="flex items-center gap-4">
                    <div className="text-sm font-medium text-zinc-500">Admin Panel</div>
                    <Button asChild variant="ghost" size="sm">
                        <Link href="/admin/evaluate">Candidate Evaluation</Link>
                    </Button>
                </div>
            </Navbar>

            <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
                <div className="w-full max-w-5xl space-y-8">
                    <div className="text-center">
                        <h2 className="text-3xl font-bold tracking-tight">Upload Document</h2>
                        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                            Upload a PDF to update the vector database.
                        </p>
                    </div>

                    <div className="max-w-md mx-auto">
                        <div className="space-y-6 bg-zinc-50 dark:bg-zinc-900 p-8 rounded-xl border border-zinc-200 dark:border-zinc-800">
                            <div className="space-y-2">
                                <label
                                    htmlFor="admin-key"
                                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                >
                                    Admin Key
                                </label>
                                <Input
                                    id="admin-key"
                                    type="password"
                                    placeholder="Enter admin key"
                                    value={adminKey}
                                    onChange={(e) => setAdminKey(e.target.value)}
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium leading-none">
                                    PDF Document
                                </label>
                                <div
                                    onClick={() => fileInputRef.current?.click()}
                                    onDragOver={handleDragOver}
                                    onDragLeave={handleDragLeave}
                                    onDrop={handleDrop}
                                    className={`relative flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${isDragging
                                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                                        : "border-zinc-300 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-600 dark:hover:bg-zinc-700"
                                        }`}
                                >
                                    {file ? (
                                        <div className="flex flex-col items-center p-4 text-center">
                                            <FileText className="w-8 h-8 mb-2 text-blue-500" />
                                            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate max-w-[200px]">
                                                {file.name}
                                            </p>
                                            <p className="text-xs text-zinc-500">
                                                {(file.size / 1024 / 1024).toFixed(2)} MB
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center pt-5 pb-6">
                                            <UploadCloud className={`w-8 h-8 mb-3 ${isDragging ? "text-blue-500" : "text-zinc-400"}`} />
                                            <p className="mb-2 text-sm text-zinc-500 dark:text-zinc-400">
                                                <span className="font-semibold">Click to upload</span> or drag and drop
                                            </p>
                                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                                PDF (MAX. 10MB)
                                            </p>
                                        </div>
                                    )}
                                    <input
                                        ref={fileInputRef}
                                        id="file-upload"
                                        type="file"
                                        accept=".pdf"
                                        className="hidden"
                                        onChange={handleFileChange}
                                    />
                                    {file && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setFile(null);
                                                if (fileInputRef.current) fileInputRef.current.value = "";
                                            }}
                                            className="absolute top-2 right-2 p-1 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
                                        >
                                            <X className="w-4 h-4 text-zinc-500" />
                                        </button>
                                    )}
                                </div>
                            </div>

                            <Button
                                onClick={handleUpload}
                                disabled={status === "uploading"}
                                className="w-full"
                            >
                                {status === "uploading" ? "Uploading..." : "Upload & Ingest"}
                            </Button>

                            {status === "uploading" && (
                                <div className="space-y-4 pt-2">
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                                            <span>Uploading File...</span>
                                            <span>{Math.round(uploadProgress)}%</span>
                                        </div>
                                        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                            <div
                                                className="h-full bg-zinc-900 dark:bg-zinc-50 transition-all duration-300 ease-out"
                                                style={{ width: `${uploadProgress}%` }}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-1">
                                        <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                                            <span>Processing & Ingesting...</span>
                                            <span>{Math.round(ingestProgress)}%</span>
                                        </div>
                                        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                            <div
                                                className="h-full bg-zinc-900 dark:bg-zinc-50 transition-all duration-300 ease-out"
                                                style={{ width: `${ingestProgress}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {message && status !== "uploading" && (
                                <div
                                    className={`p-4 rounded-md text-sm font-medium ${status === "success"
                                        ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                                        : status === "error"
                                            ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                                            : "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                                        }`}
                                >
                                    {message}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
