"use client";
import AppShell from "@/components/shell/AppShell";
import UploadView from "@/components/upload/UploadView";
import LoadingView from "@/components/loading/LoadingView";
import MappingView from "@/components/mapping/MappingView";
import ErrorView from "@/components/error/ErrorView";
import { useStore } from "@/lib/store";

export default function Home() {
  const phase = useStore((s) => s.phase);

  return (
    <AppShell>
      {phase === "upload" && <UploadView />}
      {phase === "processing" && <LoadingView />}
      {phase === "result" && <MappingView />}
      {phase === "error" && <ErrorView />}
    </AppShell>
  );
}
