import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tripId = "cmsodlqdy0001mp5wkwn2oods";
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { items: { orderBy: [{ dayIndex: "asc" }, { sortOrder: "asc" }] } },
  });
  if (!trip) {
    console.log("NOT FOUND");
    return;
  }
  console.log(
    JSON.stringify({
      id: trip.id,
      title: trip.title,
      dest: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
    }),
  );
  console.log("\n--- Items ---");
  for (const item of trip.items) {
    const hasPos = item.lng != null && item.lat != null;
    console.log(
      `D${item.dayIndex} | ${item.type} | ${item.title} | placeName=${item.placeName || "(none)"} | lng=${item.lng} lat=${item.lat} | hasPos=${hasPos}`,
    );
  }
  const withoutPos = trip.items.filter((i) => i.lng == null || i.lat == null);
  console.log(`\nTotal: ${trip.items.length}, Without position: ${withoutPos.length}`);
  for (const i of withoutPos) {
    console.log(`  MISSING: D${i.dayIndex} | ${i.placeName || i.title}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
  });