import { Check, ArrowUpRight } from "lucide-react";
import "./landing.css";

export const landingRoutes = new Set([
  "home",
  "how-it-works",
  "what-you-need",
  "questions",
]);

export default function LandingPage({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  return (
    <div className="landing" id="home">
      <a className="landing-skip" href="#how-it-works">
        Skip to how it works
      </a>
      <header className="landing-header">
        <a className="landing-brand" href="#home" aria-label="Verity home">
          <span className="landing-mark">
            <Check size={23} aria-hidden="true" />
          </span>
          verity
        </a>
        <nav aria-label="Website navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#what-you-need">What you need</a>
          {!standalone && (
            <a className="landing-signin" href="#overview">
              Sign in <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          )}
        </nav>
      </header>

      <main>
        <section className="landing-hero" aria-labelledby="landing-title">
          <p className="landing-intro">AI testing for web apps</p>
          <h1 id="landing-title">
            Make a change.
            <br />
            Check that it works.
          </h1>
          <p className="landing-lead">
            Verity helps you write test cases and run them in a browser. Find
            what passed, what failed, and what needs a closer look.
          </p>
          <div className="landing-actions">
            {!standalone && (
              <a className="landing-primary" href="#overview">
                Open Verity <ArrowUpRight size={18} aria-hidden="true" />
              </a>
            )}
            <a className="landing-secondary" href="#how-it-works">
              See how it works
            </a>
          </div>
          <p className="landing-availability">Available now as a local demo.</p>
        </section>

        <section
          className="landing-section"
          id="how-it-works"
          aria-labelledby="how-title"
        >
          <h2 id="how-title">From your app to clear test results.</h2>
          <ol className="landing-steps">
            <li>
              <span className="landing-step-number" aria-hidden="true">
                1
              </span>
              <h3>Connect your app</h3>
              <p>
                Add your test website and describe what should work. Verity
                reads the pages it can reach.
              </p>
            </li>
            <li>
              <span className="landing-step-number" aria-hidden="true">
                2
              </span>
              <h3>Review the tests</h3>
              <p>
                AI drafts test cases from your pages and requirements. You can
                edit and approve them before they run.
              </p>
            </li>
            <li>
              <span className="landing-step-number" aria-hidden="true">
                3
              </span>
              <h3>Run and see the results</h3>
              <p>
                Check your app after a change. See passed and failed tests, with
                screenshots to help you find the problem.
              </p>
            </li>
          </ol>
          <ul className="landing-benefits" aria-label="More ways to use Verity">
            <li>
              <Check size={17} aria-hidden="true" />
              Run tests again after a fix
            </li>
            <li>
              <Check size={17} aria-hidden="true" />
              Schedule regular checks
            </li>
            <li>
              <Check size={17} aria-hidden="true" />
              Download test reports
            </li>
          </ul>
        </section>

        <section
          className="landing-requirements"
          id="what-you-need"
          aria-labelledby="needs-title"
        >
          <div>
            <h2 id="needs-title">
              Bring your app.
              <br />
              We’ll help with the testing.
            </h2>
            <p>
              Start with a test copy of your website and sample data. You can
              connect your code later if you need it.
            </p>
          </div>
          <ul>
            <li>
              <Check size={20} aria-hidden="true" />
              <div>
                <h3>Your website address</h3>
                <p>An app you own or have permission to test.</p>
              </div>
            </li>
            <li>
              <Check size={20} aria-hidden="true" />
              <div>
                <h3>A test account, if needed</h3>
                <p>Login details for the pages you want to check.</p>
              </div>
            </li>
            <li>
              <Check size={20} aria-hidden="true" />
              <div>
                <h3>What should happen</h3>
                <p>
                  A short description of your main flows, such as signing in,
                  saving a profile, or placing an order.
                </p>
              </div>
            </li>
          </ul>
        </section>

        <section
          className="landing-section landing-questions"
          id="questions"
          aria-labelledby="questions-title"
        >
          <h2 id="questions-title">A few things to know.</h2>
          <div>
            <details>
              <summary>Which apps can I test?</summary>
              <p>
                Web applications you can open in a browser. Mobile app testing
                is not available yet.
              </p>
            </details>
            <details>
              <summary>Does Verity find every bug?</summary>
              <p>
                It checks the test cases you approve. It cannot promise to find
                every bug, so clear requirements and a review of each test still
                matter.
              </p>
            </details>
            <details>
              <summary>How can I use it today?</summary>
              <p>
                The current demo runs on your computer. AI needs an internet
                connection, and scheduled tests need the app to stay running.
                Cloud access and paid plans are not available yet.
              </p>
            </details>
          </div>
        </section>

        {!standalone && (
          <section className="landing-next" aria-labelledby="next-title">
            <div>
              <h2 id="next-title">See how your app holds up.</h2>
              <p>Open the workspace and connect your first test app.</p>
            </div>
            <a className="landing-primary" href="#overview">
              Open Verity <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          </section>
        )}
      </main>

      <footer className="landing-footer">
        <span>Verity · Simple checks for every change.</span>
        <a href="#questions">Questions about the demo</a>
      </footer>
    </div>
  );
}
