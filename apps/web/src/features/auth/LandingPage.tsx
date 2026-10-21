import {
  ArrowRight,
  Check,
  GitBranch,
  Layers3,
  MousePointer2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AppLink, useAppLocation } from "../../routing/index.js";
import { RoutePage } from "../../shell/RoutePage.js";
import { signInReturnPathFromSearch } from "./sign-in-return-path.js";

/** An illustrative architecture, deliberately separate from an editable graph. */
export function ArchitecturePreview() {
  return (
    <figure
      className="architecture-preview"
      aria-label="Example architecture: API Gateway invokes Lambda, which reads and writes DynamoDB"
    >
      <div className="architecture-preview__bar">
        <span>
          <span className="architecture-preview__dot" /> Notes API
        </span>
        <span>Architecture example</span>
      </div>
      <div className="architecture-preview__canvas">
        <div className="architecture-preview__boundary">
          <span>AWS · Serverless application</span>
          <div className="architecture-preview__flow">
            <div className="architecture-preview__node">
              <span className="architecture-preview__icon architecture-preview__icon--api">
                ↗
              </span>
              <strong>API Gateway</strong>
              <small>HTTPS endpoint</small>
            </div>
            <div className="architecture-preview__connection">
              <small>invoke</small>
              <ArrowRight aria-hidden="true" />
            </div>
            <div className="architecture-preview__node">
              <span className="architecture-preview__icon architecture-preview__icon--compute">
                λ
              </span>
              <strong>Lambda</strong>
              <small>Application logic</small>
            </div>
            <div className="architecture-preview__connection">
              <small>read / write</small>
              <ArrowRight aria-hidden="true" />
            </div>
            <div className="architecture-preview__node">
              <span className="architecture-preview__icon architecture-preview__icon--data">
                <Layers3 aria-hidden="true" />
              </span>
              <strong>DynamoDB</strong>
              <small>Notes data</small>
            </div>
          </div>
        </div>
        <div className="architecture-preview__note">
          <ShieldCheck aria-hidden="true" size={16} />
          <span>
            Make connections explicit.
            <br />
            <strong>Review the details before you build.</strong>
          </span>
        </div>
      </div>
      <figcaption>
        <Sparkles aria-hidden="true" size={16} />
        <span>“Design a serverless API to store and retrieve notes.”</span>
        <span className="architecture-preview__sample">
          Illustrative preview
        </span>
      </figcaption>
    </figure>
  );
}

export function LandingPage() {
  const location = useAppLocation();
  const returnPath = signInReturnPathFromSearch(location.search);
  const entrySearch =
    returnPath === undefined
      ? ""
      : "?" + new URLSearchParams({ returnTo: returnPath }).toString();
  return (
    <RoutePage
      title="Bring your cloud architecture into focus."
      routeKey="landing"
      immersive
    >
      <div className="landing">
        <section className="landing__hero" aria-labelledby="landing-title">
          <div className="landing__intro">
            <p className="landing__eyebrow">
              <span /> YOUR CLOUD. CLEARLY DEFINED.
            </p>
            <h2 id="landing-title">
              From the big idea
              <br />
              to the <em>right details.</em>
            </h2>
            <p className="landing__description">
              Design cloud architecture visually, understand how the pieces
              connect, and turn decisions into a plan you can review.
            </p>
            <div className="landing__actions">
              <AppLink
                to={"/signup" + entrySearch}
                className="button button--primary landing__primary-cta"
              >
                Create an account <ArrowRight aria-hidden="true" size={17} />
              </AppLink>
              <AppLink to={"/login" + entrySearch} className="landing__login">
                Sign in to your workspace{" "}
                <ArrowRight aria-hidden="true" size={16} />
              </AppLink>
            </div>
            <p className="landing__availability">
              CloudMarkup beta · Account creation is subject to registration
              availability.
            </p>
          </div>
          <ArchitecturePreview />
        </section>
        <div className="landing__principles" aria-label="Product approach">
          <span>
            <MousePointer2 aria-hidden="true" />
            Visual architecture
          </span>
          <span>
            <GitBranch aria-hidden="true" />
            Explicit connections
          </span>
          <span>
            <ShieldCheck aria-hidden="true" />
            Reviewable decisions
          </span>
        </div>
        <section
          className="landing__workflow"
          id="workflow"
          aria-labelledby="workflow-title"
        >
          <div className="landing__section-heading">
            <p className="landing__eyebrow">A CLEARER WAY TO WORK</p>
            <h2 id="workflow-title">
              Keep the idea and the architecture together.
            </h2>
            <p>
              One workspace to explore your design and work through what it
              needs.
            </p>
          </div>
          <ol className="landing__steps">
            <li>
              <span className="landing__step-number">01</span>
              <MousePointer2 aria-hidden="true" />
              <h3>Shape your architecture</h3>
              <p>
                Choose cloud services and arrange them on a visual canvas. Start
                with the system you want to build.
              </p>
            </li>
            <li>
              <span className="landing__step-number">02</span>
              <GitBranch aria-hidden="true" />
              <h3>Connect the details</h3>
              <p>
                Define connections and configure the pieces with guidance that
                keeps the architecture in context.
              </p>
            </li>
            <li>
              <span className="landing__step-number">03</span>
              <Check aria-hidden="true" />
              <h3>Review with confidence</h3>
              <p>
                Work through validation findings and review revisions before
                taking the next step.
              </p>
            </li>
          </ol>
        </section>
        <section className="landing__closing" aria-labelledby="closing-title">
          <div>
            <p className="landing__eyebrow">MAKE YOUR NEXT IDEA CONCRETE</p>
            <h2 id="closing-title">Your architecture starts here.</h2>
          </div>
          <AppLink
            to={"/signup" + entrySearch}
            className="button button--primary"
          >
            Get started <ArrowRight aria-hidden="true" size={17} />
          </AppLink>
        </section>
        <footer className="landing__footer">
          <span>CloudMarkup · Cloud architecture, clearly.</span>
          <nav aria-label="Landing footer">
            <AppLink to={"/login" + entrySearch}>Log in</AppLink>
            <AppLink to={"/signup" + entrySearch}>Sign up</AppLink>
            <a href="https://support.cloudmarkup.com/">Help center</a>
          </nav>
        </footer>
      </div>
    </RoutePage>
  );
}
