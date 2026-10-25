import { GENERATED_TEMPLATES } from "./laravel-templates.generated";

export interface LaravelRequestSample { label: string; method: string; url: string; body?: string }

// A starting project for the Laravel tab, plus the HTML/CSS/JS test page that talks to it.
export interface LaravelTemplate {
  id: string;
  title: string;
  description: string;
  order?: number;
  files: Record<string, string>;
  web: { html: string; css: string; js: string };
  requests: LaravelRequestSample[];
  start?: string[];
  console?: string[];
}

export const LARAVEL_TEMPLATES: LaravelTemplate[] = GENERATED_TEMPLATES;
export const templateById = (id: string) => LARAVEL_TEMPLATES.find((t) => t.id === id) ?? LARAVEL_TEMPLATES[0];
