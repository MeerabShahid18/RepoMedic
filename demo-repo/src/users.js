const users = [
  { id: 1, name: "Ada" },
  { id: 2, name: "Grace" }
];

function findUser(id) {
  return users[Number(id)];
}

module.exports = { findUser };
