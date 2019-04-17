// A map of functions which return data for the schema.
const user = {
  Query: {
    user: (root, { id }, { prisma }) => prisma.user({ id }),
    users: (root, args, context) => context.prisma.users(),
  },
  User: {
    country(parent, args, { prisma }) {
      return prisma.user({ id: parent.id }).country();
    },
  },
};

module.exports = user;
