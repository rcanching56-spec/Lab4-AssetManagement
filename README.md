# Laboratory Asset Management - Lab 4

A static HTML/JavaScript implementation for the Systems Analysis and Design role-based asset transaction laboratory.

## Run it

1. Run the SQL in `supabase-policies.sql` in the Supabase SQL Editor after your table script. This also seeds five equipment records.
2. Open `index.html` with VS Code Live Server, or publish the folder with GitHub Pages.
3. Create an account. New accounts default to the `requester` role.
4. Promote a user to `staff` or `administrator` from the Supabase Table Editor by changing `profiles.role`.

The Supabase URL and publishable key are configured in `app.js`. A publishable key is suitable for browser code only when Row Level Security is enabled. Never put a service-role key in this project.

## Lab test checklist

- Viewer opening management functions: management navigation is hidden and database policies deny restricted access.
- Staff submits request: request is created as `Pending`.
- Administrator approves or rejects: only administrators can perform the action, and an audit row is written.
- Release: only `Approved` requests can be released; availability is decremented atomically.
- Return: only `Released` requests can be returned; availability is restored unless the item is damaged.
- Audit trail: approval, rejection, release, return, and maintenance events are visible to administrators.

## Suggested submission evidence

Use the dashboard as the live GitHub Pages URL, export the supplied schema as the ERD source, and capture the Audit trail view after approving a request. The workflow displayed on the Overview page can be used as the workflow diagram reference.
