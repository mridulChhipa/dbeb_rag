"use client";

import { useState } from "react";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
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
      // Reset file input manually if needed, but state is null now
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
              <label htmlFor="admin-key" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
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
              <label htmlFor="file-upload" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                PDF Document
              </label>
              <Input
                id="file-upload"
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className="cursor-pointer file:cursor-pointer"
              />
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
