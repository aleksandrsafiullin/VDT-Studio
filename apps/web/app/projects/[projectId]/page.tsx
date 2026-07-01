import { VdtStudioApp } from "@/components/vdt/vdt-studio-app";

export default async function ProjectWorkspacePage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <VdtStudioApp projectId={projectId} />;
}
