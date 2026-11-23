# Web search

Optional web research configuration and safety limits.

Web access is **disabled by default**. Configure it in **Administration → Web**
by choosing Brave Search or SearXNG; the Brave key remains in
`$MEMORA_DATA_DIR/config/web.json` with `0600` permissions and is never returned
by the API.

In chat, the **Web** button next to attachments enables search for that session.
Sources appear in the **Sources** tab of the right side panel, together with
Files (project chats only), Context and Artifacts. The panel is closed by
default; on desktop it opens automatically on the relevant tab when a new search
arrives or an artifact is created.

Supported behavior:

- page search;
- HTML text extraction with Readability;
- text extraction from PDFs;
- numbered sources with clickable `[n]` citations in the answer;
- blocking private/local URLs, limited redirects, timeouts and size limits.

Web content is treated as **untrusted data**: it is never executed and cannot
change instructions, permissions or tools. `web_fetch` does not use JavaScript,
cookies or sessions.

Every source receives a stable number, shown as `[1]`, `[2]` in the Sources tab.
Memo must insert the reference immediately after each piece of information
obtained from the web; a sentence using multiple sources may write `[1][3]`.
References in the answer are clickable and open the matching source. Hovering or
focusing a reference shows the site, title and a short description. Numbers are
not reused when history exceeds 50 sources.

In the Sources tab:

- **Search** marks a search-engine result with title and snippet, but the page
  has not been read yet;
- **Read** marks a page actually fetched and read by Memo;
- **PDF** marks a PDF read and converted to text.
