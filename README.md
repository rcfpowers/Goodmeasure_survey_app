# Good Measure venue surveys

The staff, customer and owner surveys for the Founding thirty pilot. The survey pages are a static site for GitHub Pages; answers go to a Google Sheet through a small Google Apps Script.

```
venue-surveys/
├── index.html          the survey app (one page; the link decides which survey)
├── qr.html             makes printable QR codes for guest links
├── css/style.css
├── js/config.js        settings for this deployment: edit before publishing
├── js/app.js           renders the surveys and sends answers
├── js/qr.js
├── surveys/            the questions: staff.json, customer.json, owner.json
└── apps-script/Code.gs the Google Sheets back end (not used by the website itself)
```

## How it works

1. Each venue gets five links, each carrying a random code (`?t=…`): staff, owner, and guest links for QR code, entry invite and exit invite. The code tells the Sheet which venue, survey and channel an answer belongs to, so no one types a venue name.
2. The page asks the Apps Script what the code is for, loads that survey's questions and shows them a section at a time.
3. Answers are sent to the Apps Script, which checks the code is live and writes one row to `Staff responses`, `Customer responses` or `Owner responses`. Columns are added automatically, named by question ID (for example `SM1`, `S8`, `O4_ft`, `O5_source`).
4. Guest follow-up sign-ups and the people owners name go to a separate `Contacts` sheet, never next to the answers. You can point this at a separate, more restricted spreadsheet (see Settings).

5. Each visit also sends small progress records to a `Progress` sheet: one row when someone opens the survey (step 0), one for each part they reach (steps 1 to n), and one when they send it (the last step, named `Sent`). These carry a random visit ID, the part reached and active seconds so far, never answers. Each response row also gets `time_total` and `time_p1`, `time_p2`… columns: active seconds overall and on each part. Time with the page hidden doesn't count.

The owner survey saves on the owner's device as they go, so they can close it and come back on the same link and device. Staff and customer surveys keep nothing on the device.

## Try it locally (demo mode)

With `endpoint` empty in `js/config.js`, the app runs in demo mode: nothing is sent, and you can open surveys directly.

```bash
cd venue-surveys && python3 -m http.server 8000
```

Then open:

- http://localhost:8000/?s=staff&v=Demo%20Venue
- http://localhost:8000/?s=customer&v=Demo%20Venue&c=entry
- http://localhost:8000/?s=owner&v=Demo%20Venue
- Add `&view=all` to see every question on one page.

## Set up the Google Sheet

Use a Good Measure business Google account, not a personal Gmail, so the data sits under Good Measure's admin controls and two-step sign-in.

1. Create a new Google Sheet, for example "Venue surveys – responses". Share it only with named assessors.
2. Open **Extensions → Apps Script**, delete the sample code, paste in `apps-script/Code.gs` and save.
3. Run the `setup` function once (choose it from the function list, press Run, and allow the permissions it asks for). This creates the Settings, Venues, Links, response and Contacts sheets.
4. Click **Deploy → New deployment**, choose **Web app**, set **Execute as: Me** and **Who has access: Anyone**, then deploy. Copy the web app URL (it ends in `/exec`).
   - "Anyone" is needed because staff and guests answer without signing in. If the option is missing, your Google Workspace admin may need to allow it.
5. Paste the URL into `endpoint` in `js/config.js`, and fill in `privateContact` and `deleteBy`.

When you change `Code.gs` later, paste in the new version, save, run `setup` again (it only adds sheets that are missing), then use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.

## Reading drop-off and timings

- **Where people stop:** on the `Progress` sheet, insert a pivot table with `step_name` (or `step`) as rows, filtered by `venue_code` and `survey`, and **COUNTUNIQUE of visit_id** as values. The count at each step is how many visits got that far; the biggest fall between two steps is where people give up.
- **Opened but never started:** visits at step 0 minus visits at step 1.
- **Rushed answers:** in the response sheets, sort by `time_total` or a part's `time_p…`. Answers given much faster than reading speed allows (for example under a minute for the staff survey) are worth checking for the same answer picked every time.
- The owner survey can be finished over several sittings; its times cover only the sitting in which it was sent.

## Publish on GitHub Pages

1. Create a repository (for example `venue-surveys`) under a Good Measure GitHub account and upload the contents of this folder.
2. In the repository, go to **Settings → Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
3. The site appears at `https://<account>.github.io/venue-surveys/` within a minute or two.
4. Put that address in `base_url` on the Sheet's Settings tab.

GitHub Pages is free for public repositories. This code holds no secrets, so it can be public; never commit responses or exported data to the repository.

## Add a venue and its links

1. On the **Venues** sheet, add a row: a short code (for example `COMPTON`), the venue name as guests should see it, and `TRUE` in `open`.
2. Select that row, then choose **Good Measure → Create links for selected venue**. Five links appear on the **Links** sheet.
3. Send the staff link to the venue to share with everyone who works there, and the owner link to the owner only (treat it like a password).
4. For guests, open `qr.html` on the live site, paste the `qr` link and print the card. Use the `entry` and `exit` links on a tablet when inviting guests in person; after each guest finishes, the page offers to start again for the next one.

To close a survey, set `open` to `FALSE` for the venue, or `active` to `FALSE` for a single link.

## Privacy notes

- Staff and customer answers carry no names, emails or IP addresses. Free-text answers can still identify people, so review them before sharing anything.
- Google doesn't guarantee that Sheets data stays in the UK except on Enterprise plans. Say so in the privacy notice and data sharing agreement.
- Progress records and timings hold no answers or identifiers. The visit ID is random, made fresh for each visit and not stored on the device. Mention in the privacy notice that the survey records which parts are reached and how long they take.
- Answers that start with `=`, `+`, `-` or `@` are stored as plain text so they can't run as spreadsheet formulas.
- Delete individual answers by the deletion date you set in `deleteBy`.

## Not built yet

- A summary tab that turns answers into each measure's figures and hides groups under five.
- The guest follow-up form (F1 to F8) sent at 30 and 90 days.
- An optional upload area for venues that choose the records route.
