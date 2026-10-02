"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex("events", ["teamId", "name", "createdAt"], {
      concurrently: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      "events",
      ["teamId", "name", "createdAt"],
      { concurrently: true }
    );
  },
};
