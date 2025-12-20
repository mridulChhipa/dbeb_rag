"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, AlertTriangle, X, UploadCloud, FileText } from "lucide-react";

export default function CandidateEvaluationPage() {
    const normalizeBoolean = (value: unknown): boolean | null => {
        if (typeof value === "boolean") return value;
        if (typeof value === "string") {
            const lowered = value.trim().toLowerCase();
            if (lowered === "true") return true;
            if (lowered === "false") return false;
        }
        if (typeof value === "number") {
            if (value === 1) return true;
            if (value === 0) return false;
        }
        return null;
    };

    const parseReasoning = (value?: string | null) => {
        if (!value) return "";
        const trimmed = value.trim();
        if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
            const inner = trimmed.slice(3, -3).trim();
            const newlineIndex = inner.indexOf("\n");
            if (newlineIndex !== -1 && /^[a-z0-9]+$/i.test(inner.slice(0, newlineIndex))) {
                return parseReasoning(inner.slice(newlineIndex + 1));
            }
            return inner.trim();
        }
        return value;
    };

    const [criteriaFile, setCriteriaFile] = useState<File | null>(null);
    const [candidatesCsv, setCandidatesCsv] = useState<File | null>(null);
    const [resumesZip, setResumesZip] = useState<File | null>(null);
    const [evaluationStatus, setEvaluationStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
    const [evaluationMessage, setEvaluationMessage] = useState("");
    const [evaluationResults, setEvaluationResults] = useState<Array<any>>([]);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [processingProgress, setProcessingProgress] = useState(0);
    const [criteriaDragging, setCriteriaDragging] = useState(false);
    const [csvDragging, setCsvDragging] = useState(false);
    const [resumesDragging, setResumesDragging] = useState(false);

    const criteriaInputRef = useRef<HTMLInputElement | null>(null);
    const csvInputRef = useRef<HTMLInputElement | null>(null);
    const resumesInputRef = useRef<HTMLInputElement | null>(null);
    const processingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const clearProcessingTimer = () => {
        if (processingIntervalRef.current) {
            clearInterval(processingIntervalRef.current);
            processingIntervalRef.current = null;
        }
    };

    useEffect(() => () => clearProcessingTimer(), []);

    const clearStatus = () => {
        if (evaluationStatus !== "loading") {
            setEvaluationStatus("idle");
            setEvaluationMessage("");
        }
    };

    const formatSize = (file?: File | null) => {
        if (!file) return "";
        return `${(file.size / 1024 / 1024).toFixed(2)} MB`;
    };

    const validateAndSetFile = (file: File | null, type: "criteria" | "csv" | "resumes") => {
        clearStatus();

        if (!file) {
            if (type === "criteria") setCriteriaFile(null);
            if (type === "csv") setCandidatesCsv(null);
            if (type === "resumes") setResumesZip(null);
            return;
        }

        const lower = file.name.toLowerCase();
        const validate = (suffixes: string[]) => suffixes.some((suffix) => lower.endsWith(suffix));

        if (type === "criteria" && !validate([".pdf", ".txt", ".md"])) {
            setEvaluationStatus("error");
            setEvaluationMessage("Criteria must be a PDF, TXT, or Markdown file.");
            return;
        }
        if (type === "csv" && !validate([".csv"])) {
            setEvaluationStatus("error");
            setEvaluationMessage("Candidate roster must be a CSV file.");
            return;
        }
        if (type === "resumes" && !validate([".zip"])) {
            setEvaluationStatus("error");
            setEvaluationMessage("Resumes archive must be a ZIP file.");
            return;
        }

        if (type === "criteria") setCriteriaFile(file);
        if (type === "csv") setCandidatesCsv(file);
        if (type === "resumes") setResumesZip(file);
    };

    const handleDrop = (
        event: React.DragEvent,
        type: "criteria" | "csv" | "resumes",
        setDragging: (value: boolean) => void
    ) => {
        event.preventDefault();
        setDragging(false);
        const droppedFile = event.dataTransfer.files?.[0];
        if (droppedFile) {
            validateAndSetFile(droppedFile, type);
        }
    };

    const renderDropzone = (
        label: string,
        description: string,
        file: File | null,
        accept: string,
        inputRef: { current: HTMLInputElement | null },
        type: "criteria" | "csv" | "resumes",
        dragging: boolean,
        setDragging: (value: boolean) => void
    ) => (
        <div className="space-y-2">
            <label className="text-sm font-medium leading-none">{label}</label>
            <div
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                }}
                onDragLeave={(event) => {
                    event.preventDefault();
                    setDragging(false);
                }}
                onDrop={(event) => handleDrop(event, type, setDragging)}
                className={`relative flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${dragging
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
                        <p className="text-xs text-zinc-500">{formatSize(file)}</p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center pt-5 pb-6">
                        <UploadCloud className={`w-8 h-8 mb-3 ${dragging ? "text-blue-500" : "text-zinc-400"}`} />
                        <p className="mb-2 text-sm text-zinc-500 dark:text-zinc-400">
                            <span className="font-semibold">Click to upload</span> or drag and drop
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
                    </div>
                )}
                <Input
                    ref={inputRef}
                    type="file"
                    accept={accept}
                    className="hidden"
                    onChange={(event) => validateAndSetFile(event.target.files?.[0] || null, type)}
                />
                {file && (
                    <button
                        onClick={(event) => {
                            event.stopPropagation();
                            validateAndSetFile(null, type);
                            if (inputRef.current) inputRef.current.value = "";
                        }}
                        className="absolute top-2 right-2 p-1 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
                        aria-label={`Remove ${label}`}
                    >
                        <X className="w-4 h-4 text-zinc-500" />
                    </button>
                )}
            </div>
        </div>
    );

    const handleEvaluationSubmit = async () => {
        if (!criteriaFile || !candidatesCsv || !resumesZip) {
            setEvaluationStatus("error");
            setEvaluationMessage("Please provide a criteria file, candidate CSV, and resumes archive.");
            return;
        }

        setEvaluationStatus("loading");
        setEvaluationMessage("");
        setEvaluationResults([]);
        setUploadProgress(0);
        setProcessingProgress(0);
        clearProcessingTimer();

        const formData = new FormData();
        formData.append("criteria", criteriaFile);
        formData.append("candidates_csv", candidatesCsv);
        formData.append("resumes_zip", resumesZip);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "http://127.0.0.1:8000/evaluate-candidates");

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percent = (event.loaded / event.total) * 100;
                setUploadProgress(percent);
            }
        };

        xhr.upload.onload = () => {
            setUploadProgress(100);
            if (!processingIntervalRef.current) {
                setProcessingProgress(5);
                processingIntervalRef.current = setInterval(() => {
                    setProcessingProgress((previous) => {
                        if (previous >= 95) {
                            clearProcessingTimer();
                            return previous;
                        }
                        return previous + 5;
                    });
                }, 500);
            }
        };

        xhr.onreadystatechange = () => {
            if (xhr.readyState === XMLHttpRequest.HEADERS_RECEIVED && !processingIntervalRef.current) {
                setProcessingProgress((previous) => (previous > 5 ? previous : 5));
                processingIntervalRef.current = setInterval(() => {
                    setProcessingProgress((previous) => {
                        if (previous >= 95) {
                            clearProcessingTimer();
                            return previous;
                        }
                        return previous + 5;
                    });
                }, 500);
            }
        };

        xhr.onload = () => {
            clearProcessingTimer();
            setProcessingProgress(100);

            try {
                const text = xhr.responseText || "{}";
                const payload = JSON.parse(text);

                if (xhr.status >= 200 && xhr.status < 300) {
                    const evaluated = payload.evaluated_candidates || [];
                    setEvaluationResults(evaluated);
                    const count = evaluated.length;
                    setEvaluationMessage(`Evaluated ${count} candidate${count === 1 ? "" : "s"}.`);
                    setEvaluationStatus("success");
                } else {
                    const detail = payload.detail || payload.message || "Evaluation failed.";
                    setEvaluationResults([]);
                    setEvaluationStatus("error");
                    setEvaluationMessage(typeof detail === "string" ? detail : JSON.stringify(detail));
                }
            } catch (error) {
                console.error("Failed to parse evaluation response", error);
                setEvaluationResults([]);
                setEvaluationStatus("error");
                setEvaluationMessage("Evaluation failed to return valid data.");
            }
        };

        xhr.onerror = () => {
            clearProcessingTimer();
            setEvaluationResults([]);
            setEvaluationStatus("error");
            setEvaluationMessage("Network error occurred while evaluating candidates.");
            setUploadProgress(0);
            setProcessingProgress(0);
        };

        xhr.onabort = () => {
            clearProcessingTimer();
            setEvaluationResults([]);
            setEvaluationStatus("error");
            setEvaluationMessage("Evaluation request was aborted.");
            setUploadProgress(0);
            setProcessingProgress(0);
        };

        xhr.send(formData);
    };

    return (
        <div className="flex min-h-screen flex-col bg-background text-foreground font-sans">
            <Navbar>
                <div className="flex items-center justify-between w-full">
                    <div className="text-sm font-medium text-zinc-500">Candidate Evaluation</div>
                    <Button asChild variant="ghost" size="sm">
                        <Link href="/admin">Back to Admin</Link>
                    </Button>
                </div>
            </Navbar>

            <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
                <div className="w-full max-w-4xl space-y-8">
                    <div className="text-center space-y-2">
                        <h1 className="text-3xl font-bold tracking-tight">Evaluate Candidates</h1>
                        <p className="text-sm text-zinc-600 dark:text-zinc-400">
                            Upload the selection criteria, candidate roster, and resumes archive. The LLM will flag candidates that do not meet the minimum requirements.
                        </p>
                    </div>

                    <div className="space-y-6 bg-zinc-50 dark:bg-zinc-900 p-8 rounded-xl border border-zinc-200 dark:border-zinc-800">
                        <div className="grid gap-4 md:grid-cols-2">
                            {renderDropzone(
                                "Selection Criteria (PDF or TXT)",
                                "PDF, TXT, or Markdown",
                                criteriaFile,
                                ".pdf,.txt,.md",
                                criteriaInputRef,
                                "criteria",
                                criteriaDragging,
                                setCriteriaDragging
                            )}

                            {renderDropzone(
                                "Candidates CSV (must include resume_filename)",
                                "CSV only",
                                candidatesCsv,
                                ".csv",
                                csvInputRef,
                                "csv",
                                csvDragging,
                                setCsvDragging
                            )}

                            <div className="md:col-span-2">
                                {renderDropzone(
                                    "Resumes Archive (.zip)",
                                    "ZIP file containing resumes",
                                    resumesZip,
                                    ".zip",
                                    resumesInputRef,
                                    "resumes",
                                    resumesDragging,
                                    setResumesDragging
                                )}
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                            <Button
                                type="button"
                                onClick={handleEvaluationSubmit}
                                disabled={evaluationStatus === "loading"}
                                className="shrink-0"
                            >
                                {evaluationStatus === "loading" ? "Evaluating..." : "Evaluate Candidates"}
                            </Button>
                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                Ensure resume filenames in the CSV exactly match the files inside the ZIP archive.
                            </p>
                        </div>

                        {evaluationStatus === "loading" && (
                            <div className="space-y-4 pt-2">
                                <div className="space-y-1">
                                    <div className="flex justify-between text-xs text-zinc-500 dark:text-zinc-400">
                                        <span>Uploading Files...</span>
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
                                        <span>Processing Evaluation...</span>
                                        <span>{Math.round(processingProgress)}%</span>
                                    </div>
                                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                        <div
                                            className="h-full bg-zinc-900 dark:bg-zinc-50 transition-all duration-300 ease-out"
                                            style={{ width: `${processingProgress}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {evaluationMessage && (
                            <div
                                className={`p-4 rounded-md text-sm font-medium ${evaluationStatus === "success"
                                        ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                                        : evaluationStatus === "error"
                                            ? "bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400"
                                            : "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400"
                                    }`}
                            >
                                {evaluationMessage}
                            </div>
                        )}

                        {evaluationResults.length > 0 && (
                            <div className="space-y-4">
                                <h4 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                                    Evaluation Results
                                </h4>
                                <div className="space-y-3">
                                    {evaluationResults.map((result, index) => {
                                        const evaluation = result.evaluation;
                                        const missing = evaluation?.missing_criteria || [];
                                        const candidateLabel = result.candidate_id || result.row?.name || `Candidate ${index + 1}`;
                                        const meetsNormalized = normalizeBoolean(evaluation?.meets_requirements);
                                        const meets = meetsNormalized === true;
                                        const hasError = Boolean(result.error);
                                        const codeforcesRating = evaluation?.codeforces_rating;
                                        const reasoningTextRaw = evaluation?.reasoning;
                                        let reasoningText = parseReasoning(reasoningTextRaw);
                                        let missingCriteria = Array.isArray(evaluation?.missing_criteria)
                                            ? evaluation?.missing_criteria
                                            : [];

                                        if (reasoningText) {
                                            try {
                                                const parsed = JSON.parse(reasoningText);
                                                if (parsed && typeof parsed === "object") {
                                                    reasoningText = typeof parsed.reasoning === "string" ? parsed.reasoning : reasoningText;
                                                    if (Array.isArray(parsed.missing_criteria)) {
                                                        missingCriteria = parsed.missing_criteria;
                                                    }
                                                    if (parsed.codeforces_rating && !codeforcesRating) {
                                                        evaluation.codeforces_rating = parsed.codeforces_rating;
                                                    }
                                                    const parsedMeets = normalizeBoolean(parsed.meets_requirements);
                                                    if (parsedMeets !== null) {
                                                        evaluation.meets_requirements = parsedMeets;
                                                    }
                                                }
                                            } catch {
                                                // ignore parse errors, treat as plain text
                                            }
                                        }

                                        return (
                                            <div
                                                key={`${candidateLabel}-${index}`}
                                                className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950"
                                            >
                                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                                    <div>
                                                        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                            {candidateLabel}
                                                        </p>
                                                        {result.resume_filename && (
                                                            <p className="text-xs text-zinc-500 dark:text-zinc-400">
                                                                Resume: {result.resume_filename}
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2 text-sm">
                                                        {hasError ? (
                                                            <>
                                                                <AlertTriangle className="w-4 h-4 text-red-500" />
                                                                <span className="text-red-600 dark:text-red-400">Error</span>
                                                            </>
                                                        ) : meets ? (
                                                            <>
                                                                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                                                <span className="text-emerald-600 dark:text-emerald-400">Meets requirements</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <AlertTriangle className="w-4 h-4 text-amber-500" />
                                                                <span className="text-amber-600 dark:text-amber-400">Does not meet minimums</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>

                                                {hasError ? (
                                                    <p className="mt-3 text-sm text-red-600 dark:text-red-400">
                                                        {result.error}
                                                    </p>
                                                ) : (
                                                    <div className="mt-3 space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
                                                        {reasoningText && (
                                                            <p>
                                                                <span className="font-medium">Reasoning:</span> {reasoningText}
                                                            </p>
                                                        )}
                                                        {codeforcesRating !== undefined && codeforcesRating !== null && (
                                                            <p>
                                                                <span className="font-medium">Codeforces rating:</span> {codeforcesRating}
                                                            </p>
                                                        )}
                                                        {missingCriteria.length > 0 && (
                                                            <div>
                                                                <p className="font-medium">Missing criteria:</p>
                                                                <ul className="list-disc pl-5 space-y-1">
                                                                    {missingCriteria.map((item: string, itemIndex: number) => (
                                                                        <li key={itemIndex}>{item}</li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}
                                                        {evaluation?.raw_response && (
                                                            <details className="text-xs">
                                                                <summary className="cursor-pointer text-zinc-500 dark:text-zinc-400">
                                                                    View raw LLM response
                                                                </summary>
                                                                <pre className="mt-1 whitespace-pre-wrap rounded-md bg-zinc-100 dark:bg-zinc-800 p-2">
                                                                    {evaluation.raw_response}
                                                                </pre>
                                                            </details>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
