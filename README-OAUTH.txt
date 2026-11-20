GTA World login setup
1. In Vercel: Project > Settings > Environment Variables. Add (all environments):
   GTAW_CLIENT_ID      (from GTA World)
   GTAW_CLIENT_SECRET  (from GTA World, keep private)
   SESSION_SECRET      (any long random text, 40+ characters)
2. Redeploy (Deployments > ... > Redeploy).
3. The Redirect URL registered with GTA World must be exactly:
   https://cypress-customs.vercel.app/api/callback
