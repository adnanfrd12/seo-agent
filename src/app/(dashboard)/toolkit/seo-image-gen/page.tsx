import { TabHeader } from "@/components/dashboard/tab-header";
import { BackToToolkit, Card } from "@/components/toolkit/bits";

/** Placeholder: the claude-seo seo-image-gen skill (MIT, github.com/AgricIDaniel/claude-seo) uses Google Gemini image models. */
export default function ImageGenPage() {
  return (
    <>
      <BackToToolkit />
      <TabHeader source={null} title="Image Generation" description="AI-generated images for blog posts and service pages." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Needs a Gemini API key">
          <p className="text-sm text-secondary">Not built yet because no Gemini API key is configured. Add GEMINI_API_KEY to the server environment and ask for the tool to be enabled.</p>
        </Card>
        <Card title="Meanwhile">
          <p className="text-sm text-secondary">Real project photos usually beat generated images: they show actual work and build trust. The Image Audit tool checks the existing photos.</p>
        </Card>
      </div>
    </>
  );
}
