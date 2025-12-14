"use client";

import { useState, useRef } from "react";
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

  const handleUpload = async () => {
    if (!file || !adminKey) {
      setMessage("Please provide both Admin Key and a file.");
      setStatus("error");
      return;
    }

    setStatus("uploading");
    setMessage("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("http://127.0.0.1:8000/upload", {
        method: "POST",
        headers: {
          "X-Admin-Key": adminKey,
        },
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Upload failed");
      }

      const data = await res.json();
      setMessage(data.message || "Upload successful!");
      setStatus("success");
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (error: any) {
      console.error(error);
      setMessage(error.message || "An error occurred.");
      setStatus("error");
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground font-sans">
      <Navbar>
        <div className="text-sm font-medium text-zinc-500">Admin Panel</div>
      </Navbar>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight">Upload Document</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Upload a PDF to update the vector database.
            </p>
          </div>

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
                className={`relative flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
                  isDragging
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

            {message && (
              <div
                className={`p-4 rounded-md text-sm font-medium ${
                  status === "success"
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
      </main>
    </div>
  );
}
