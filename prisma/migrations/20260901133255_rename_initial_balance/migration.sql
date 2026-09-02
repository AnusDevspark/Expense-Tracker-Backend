/*
  Warnings:

  - You are about to drop the column `initalBalance` on the `accounts` table. All the data in the column will be lost.
  - Added the required column `initialBalance` to the `accounts` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "accounts" DROP COLUMN "initalBalance",
ADD COLUMN     "initialBalance" DECIMAL(10,2) NOT NULL;
