#!/usr/bin/env bash
set -euo pipefail

release_api="repos/$GITHUB_REPOSITORY/releases"

tag_commit() {
  git ls-remote origin "refs/tags/$RELEASE_TAG" "refs/tags/$RELEASE_TAG^{}" |
    awk '$2 ~ /\^\{\}$/ { peeled=$1; next } { tag=$1 } END { print peeled ? peeled : tag }'
}

check_tag() {
  local commit
  commit=$(tag_commit)
  if [[ -n "$commit" && "$commit" != "$GITHUB_SHA" ]]; then
    echo "::error::$RELEASE_TAG already points to $commit instead of $GITHUB_SHA"
    return 1
  fi
}

# GitHub's release-by-tag API only returns published releases. List drafts too
# so a failed upload can resume on the same commit.
check_tag
release=$(gh api --paginate "$release_api?per_page=100" |
  jq -cs --arg tag "$RELEASE_TAG" '
    [.[][] | select(.tag_name == $tag)] |
    if length > 1 then error("multiple releases for " + $tag) else .[0] // empty end
  ')

if [[ -z "$release" ]]; then
  release=$(gh api --method POST "$release_api" \
    -f tag_name="$RELEASE_TAG" -f target_commitish="$GITHUB_SHA" \
    -f name="PMBus Calculator $RELEASE_TAG" -F draft=true -F generate_release_notes=true)
else
  jq -e '.draft == true' <<< "$release" >/dev/null || {
    echo "::error::$RELEASE_TAG is already published. Redeploy it by specifying release_tag."
    exit 1
  }
fi

release_id=$(jq -er --arg sha "$GITHUB_SHA" '
  select(.draft == true and .prerelease == false and .target_commitish == $sha) | .id
' <<< "$release") || {
  echo "::error::$RELEASE_TAG is not a stable draft for $GITHUB_SHA"
  exit 1
}

zip="release-output/$ZIP_NAME"
sums="release-output/$SUMS_NAME"
zip_hash=$(sha256sum < "$zip")
sums_hash=$(sha256sum < "$sums")
gh release upload "$RELEASE_TAG" "$zip" "$sums" --repo "$GITHUB_REPOSITORY" --clobber

# Check GitHub's calculated digests before the draft becomes immutable.
if ! gh api "$release_api/$release_id" |
  jq -e --arg sha "$GITHUB_SHA" --arg tag "$RELEASE_TAG" \
    --arg zip "$ZIP_NAME" --arg sums "$SUMS_NAME" \
    --arg zip_digest "sha256:${zip_hash%% *}" --arg sums_digest "sha256:${sums_hash%% *}" '
      def uploaded($name; $digest):
        [.assets[] | select(.name == $name and .state == "uploaded" and .digest == $digest)] | length == 1;
      .draft == true and .prerelease == false and .tag_name == $tag and .target_commitish == $sha and
        (.assets | length == 2) and uploaded($zip; $zip_digest) and uploaded($sums; $sums_digest)
    ' >/dev/null; then
  echo "::error::The GitHub draft does not match the two local release assets."
  exit 1
fi

check_tag
gh api --method PATCH "$release_api/$release_id" \
  -F draft=false -f target_commitish="$GITHUB_SHA" -f make_latest=true --silent
if ! gh api "$release_api/$release_id" |
  jq -e --arg tag "$RELEASE_TAG" '
    select(.tag_name == $tag and .draft == false and .prerelease == false and .immutable == true)
    | .html_url
  '; then
  echo "::error::GitHub did not confirm an immutable release for $RELEASE_TAG."
  exit 1
fi
published_commit=$(tag_commit)
if [[ "$published_commit" != "$GITHUB_SHA" ]]; then
  echo "::error::$RELEASE_TAG does not point to $GITHUB_SHA after publication"
  exit 1
fi
