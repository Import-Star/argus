export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
  key: string;
  url: string;
}

const PR_URL_REGEX = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[^\s]*)?/gi;

export function parsePullRequestLinks(input: string): PullRequestRef[] {
  const refs: PullRequestRef[] = [];
  const seen = new Set<string>();

  for (const match of input.matchAll(PR_URL_REGEX)) {
    const owner = match[1];
    const repo = match[2];
    const number = Number(match[3]);

    if (!owner || !repo || Number.isNaN(number)) {
      continue;
    }

    const key = `${owner}/${repo}#${number}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    refs.push({
      owner,
      repo,
      number,
      key,
      url: `https://github.com/${owner}/${repo}/pull/${number}`
    });
  }

  return refs;
}
