import {
  ArrowRight,
  LayoutTemplate,
  Plus,
  Sparkles,
  Upload,
} from "lucide-react";

import { AppLink } from "../../routing/index.js";

export function ProjectStartLinks({ root }: { readonly root: string }) {
  return (
    <section className="project-start" aria-labelledby="project-start-title">
      <div className="project-start__intro">
        <h2 id="project-start-title">Where would you like to start?</h2>
      </div>
      <div className="project-start__links">
        <AppLink
          className="project-start__link project-start__link--ai"
          to={root + "/projects/new?start=prompt"}
        >
          <Sparkles aria-hidden="true" size={20} />
          <span>
            <span className="project-start__badge">
              Your architecture, assisted
            </span>
            <strong>Create with AI</strong>
            <small>
              Describe your idea. Review a thoughtful architecture, refine its
              settings, and build from there.
            </small>
          </span>
          <ArrowRight aria-hidden="true" size={16} />
        </AppLink>
        <AppLink className="project-start__link" to={`${root}/projects/new`}>
          <Plus aria-hidden="true" size={20} />
          <span>
            <strong>Blank canvas</strong>
            <small>Add services as you go</small>
          </span>
          <ArrowRight aria-hidden="true" size={16} />
        </AppLink>
        <AppLink className="project-start__link" to={`${root}/templates`}>
          <LayoutTemplate aria-hidden="true" size={20} />
          <span>
            <strong>Explore templates</strong>
            <small>Start with a reviewed example</small>
          </span>
          <ArrowRight aria-hidden="true" size={16} />
        </AppLink>
        <AppLink
          className="project-start__link"
          to={`${root}/projects/new?start=import`}
        >
          <Upload aria-hidden="true" size={20} />
          <span>
            <strong>Import existing code</strong>
            <small>Review Terraform or CloudFormation from GitHub</small>
          </span>
          <ArrowRight aria-hidden="true" size={16} />
        </AppLink>
      </div>
    </section>
  );
}
