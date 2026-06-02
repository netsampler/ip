# Web IP Calculator

A dependency-free single-page IP calculator for IPv4 and IPv6 prefixes.

## Run

```sh
npm run dev
```

Then open [http://localhost:4173](http://localhost:4173).

Set a different port with any of these:

```sh
npm run dev -- --port 3000
npm run dev -- -p 3000
npm run dev -- 3000
PORT=3000 npm run dev
```

The app also works by opening `index.html` directly in a browser.

## Controls

- Type an IPv4 or IPv6 address/prefix to calculate the normalized range.
- Use the Current representation control to view addresses as regular notation, hex, binary, or an integer.
- IPv4 defaults to regular dotted notation; IPv6 defaults to expanded hex.
- The current prefix is saved in the URL as `?prefix=...` so bookmarks and shared links reopen the same calculation.
- Use `ArrowUp` / `ArrowDown` to move by `-2ⁿ` / `+2ⁿ` to adjacent prefixes.
- Use the prefix navigation buttons beside the field for the same moves without a keyboard.
- Use `PageUp` / `PageDown` to jump by ten prefixes.
- Use mouse back/forward side buttons to move through committed prefix history.
- Press `Tab` to accept the inline completion.
