import type {
  DiscoverGithubRepositoryV1,
  GithubRepositoryDiscoveryV1,
} from "@cloudmarkup/api-contract";
import { Button } from "@cloudmarkup/ui";
import { useEffect, useRef, useState } from "react";

const PAGE_SIZE = 50;

/** Mount with a source key so a response cannot cross repository/commit selection. */
export function GitHubRepositoryFilePicker({
  input,
  onDiscover,
  onSelect,
}: {
  readonly input: DiscoverGithubRepositoryV1;
  readonly onDiscover: (
    input: DiscoverGithubRepositoryV1,
  ) => Promise<GithubRepositoryDiscoveryV1>;
  readonly onSelect: (paths: readonly string[]) => void;
}) {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [result, setResult] = useState<GithubRepositoryDiscoveryV1>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<string>();
  const filtered =
    result?.files.filter((file) =>
      file.path.toLowerCase().includes(filter.toLowerCase()),
    ) ?? [];
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const validSource =
    input.integrationId !== "" &&
    input.repositoryId > 0 &&
    input.branch !== "" &&
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(input.commitSha);

  async function discover() {
    if (pending || !validSource) return;
    setPending(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const value = await onDiscover(input);
      if (!active.current) return;
      if (
        value.integrationId !== input.integrationId ||
        value.repositoryId !== input.repositoryId ||
        value.branch !== input.branch ||
        value.commitSha !== input.commitSha
      ) {
        throw new Error(
          "The file list no longer matches your repository selection. Try again.",
        );
      }
      setResult(value);
      setSelected([]);
      setPage(0);
      setFilter("");
    } catch (reason) {
      if (active.current)
        setError(
          reason instanceof Error
            ? reason.message
            : "The repository file list could not be loaded.",
        );
    } finally {
      if (active.current) setPending(false);
    }
  }

  return (
    <section
      aria-label="Choose repository files"
      className="github-repository-import__picker"
    >
      <div className="github-repository-import__actions">
        <Button
          type="button"
          disabled={!validSource || pending}
          loading={pending}
          onClick={() => void discover()}
        >
          {result === undefined
            ? "Discover repository files"
            : "Refresh file list"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            onSelect(["."]);
            setSelected([]);
            setNotice("Import scope set to all eligible files.");
          }}
        >
          Scan all eligible files
        </Button>
      </div>
      <p>
        Browse file names before importing, or scan all eligible files. Ignored
        and sensitive files are excluded. Import checks file contents before
        proposing changes.
      </p>
      {pending ? (
        <p role="status">Reading the file list for your selected commit…</p>
      ) : null}
      {error === undefined ? null : <p role="alert">{error}</p>}
      {notice === undefined ? null : <p role="status">{notice}</p>}
      {result === undefined ? null : (
        <>
          {result.branchChangedSinceSelection ? (
            <p role="status">
              The branch has moved. This list still uses your selected commit.
            </p>
          ) : null}
          <p>
            {result.files.length} eligible files · {selected.length} of 128
            files selected
          </p>
          {result.files.length === 0 ? (
            <p>
              No eligible files were found. Review ignored paths or choose
              another commit.
            </p>
          ) : (
            <>
              <label>
                Find repository files
                <input
                  type="search"
                  value={filter}
                  onChange={(event) => {
                    setFilter(event.currentTarget.value);
                    setPage(0);
                  }}
                />
              </label>
              <ul className="github-repository-import__files">
                {visible.map((file) => (
                  <li key={file.path}>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={"Select " + file.path}
                        checked={selected.includes(file.path)}
                        disabled={
                          !selected.includes(file.path) &&
                          selected.length >= 128
                        }
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setSelected((current) =>
                            checked
                              ? [...current, file.path]
                              : current.filter((path) => path !== file.path),
                          );
                          setNotice(undefined);
                        }}
                      />
                      <span>
                        {file.path}
                        <small>{file.sizeBytes.toLocaleString()} bytes</small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {filtered.length === 0 ? (
                <p>No file names match this search.</p>
              ) : (
                <nav
                  aria-label="Repository file pages"
                  className="github-repository-import__actions"
                >
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={page === 0}
                    onClick={() => {
                      setPage((value) => value - 1);
                    }}
                  >
                    Previous files
                  </Button>
                  <span>
                    Page {page + 1} of{" "}
                    {Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={(page + 1) * PAGE_SIZE >= filtered.length}
                    onClick={() => {
                      setPage((value) => value + 1);
                    }}
                  >
                    Next files
                  </Button>
                </nav>
              )}
              <Button
                type="button"
                disabled={selected.length === 0}
                onClick={() => {
                  onSelect([...selected].sort());
                  setNotice("Import scope updated to your selected files.");
                }}
              >
                Use selected files
              </Button>
            </>
          )}
        </>
      )}
    </section>
  );
}
