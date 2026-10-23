const express = require("express");
const { findUser } = require("./users");

const app = express();

app.get("/api/users/:id", (request, response) => {
  const user = findUser(request.params.id);
  if (!user) return response.status(404).json({ error: "User not found" });
  response.json(user);
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 5050;
  app.listen(port, () => console.log(`Sample API listening on http://localhost:${port}`));
}

module.exports = app;
