# Deploy SourceBuddy to Netlify

This project is ready to run as a Netlify site with a Netlify Function for `/api/*` and Netlify Blobs for persistent company and account data.

## First deployment

1. Push the `leadsapp` folder to a GitHub repository.
2. In Netlify, select **Add new project** and import that repository.
3. Set the project base directory to `leadsapp` if the repository contains this folder. If the repository contains only the contents of `leadsapp`, leave the base directory empty.
4. Netlify reads `netlify.toml` automatically. The publish directory is the project root and functions are in `netlify/functions`.
5. In **Project configuration → Environment variables**, add `SESSION_SECRET` with a unique random value of at least 32 characters. For example, generate one locally with:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

6. Deploy the project.
7. Open the deployed site URL. It will open the first-time setup page; create the first administrator there.

Company data is initialized from `companies.js` once, on the first API request. Users, passwords, access assignments, and later company changes are stored in the Netlify Blob store named `sourcebuddy`.

## Local Netlify development

```powershell
cd C:\path\to\leadsapp
npm.cmd install
npm.cmd run dev
```

Link the local folder to the Netlify project when prompted, so local development can access the project's Blob store and environment variables. Never use the production site for test accounts or test data.

## Important notes

- `auth-data.json` is intentionally excluded from Netlify deployments. Existing local users are not migrated; create production administrators through the setup screen.
- Do not commit the `SESSION_SECRET` to Git or put it in frontend JavaScript.
- To reset a test deployment, delete the `app-data` entry in the `sourcebuddy` Blob store from Netlify's Blobs UI. This removes all hosted users and company changes for that site.
