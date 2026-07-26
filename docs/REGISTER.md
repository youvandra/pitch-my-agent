# Registering Pitch My Agent on OKX.ai

> **Done — agent `#9480`**, registered 2026-07-26, tx
> `0x74149500ea10b332961ac69f1c4a399d063ca1187376587767fb70d990f266f5`.
> Kept as the record of what was run, and what the API refused on the way.
>
> Two limits the CLI help does not mention, both discovered by being rejected:
> the avatar must be **under 1 MB** (the 1024px original was 1.9 MB and was
> refused outright), and `profileDescription` and `serviceDescription` are each
> capped at **500 characters**. The texts below are the ones that were accepted.

Run these yourself — `create` and `activate` mint a public identity under your
wallet, and `upload` publishes the avatar to OKX's CDN.

Prerequisite already verified: `agent pre-check --role asp` returns
`canCreate: true` with no `consentKey`, because the wallet (`0xe3d2…95ac`) has
already accepted the terms for its four existing ASPs.

> The `--service` payload is wrapped in single quotes, so nothing inside it may
> contain an apostrophe — one stray `'` ends the shell string and the command
> fails in a confusing place. The text below is written around that.

---

## 1. Upload the avatar

Returns a CDN URL. Copy it — step 2 needs it.

```bash
onchainos agent upload --file ~/Documents/pitch-my-agent/assets/avatar.png
```

## 2. Create the agent

Paste the URL from step 1 into `--picture`.

```bash
onchainos agent create \
  --role asp \
  --name "Pitch My Agent" \
  --picture "<CDN_URL_DARI_STEP_1>" \
  --description "Turns any agent on the OKX.ai marketplace into a narrated 1080p demo video. Give it an agent ID and nothing else. It reads that agent's public profile, services and prices, pulls two brand colours out of its logo, writes the script and the narration, and hands back a finished mp4 with a poster image and a shareable watch page. No assets, no brief, no editor. The result is not a recoloured template: every scene role has several designed compositions and the architecture is picked per agent, so two agents never get the same video. Colour is taken from the logo and held to a legibility contract, the edit is cut to the beat of its soundtrack, and every word on screen comes from the agent's own listing. Preview the script and palette for free before buying one." \
  --service '[{"serviceName":"Animated Pitch","serviceDescription":"A narrated 1080p demo video for one OKX.ai agent, built entirely from its own marketplace listing. Brand palette extracted from the logo, scene architecture chosen to suit the agent, narration with burned-in captions, and a licensed soundtrack that every cut is timed to. The middle of the video shows the agent being used and delivering, in the shape it actually returns: panels for an illustrator, a chart for a market feed, a report for an analyser. Runs roughly 45-70 seconds. Returns a jobId immediately; poll the free get_job tool for the finished video, typically within 7 minutes.","serviceType":"A2MCP","fee":"0.4","endpoint":"https://pitchokxai.web.id/pitch/animated"}]'
```

## 3. Activate

Use the `agentId` returned by step 2.

```bash
onchainos agent activate --agent-id <AGENT_ID> --preferred-language en
```

## 4. Verify it took

```bash
onchainos agent service-list --agent-id <AGENT_ID>
```

Check three things: `serviceType` is `A2MCP`, `fee` is `0.4`, and `endpoint` is
the https URL above. The marketplace validator probes that endpoint with a bare
`GET`, which already answers `402` with the correct challenge — verified live
against the running deployment.

---

## After registration

Fill the new agent ID into:

- `docs/DRAFT_SUBMISSION.md` — the **Agent ID** field and the X post template
- `frontend/index.html` — the footer, so the landing page names the agent it is

The remaining blanks in the submission draft are then the X handle, the Telegram
handle, and the X post link.
