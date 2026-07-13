export function calculateRoomSizes(totalEntries, targetSize = 30) {
  if (!Number.isInteger(totalEntries) || totalEntries <= 0) {
    return [];
  }
  if (!Number.isInteger(targetSize) || targetSize <= 0) {
    return [];
  }

  const roomCount = Math.max(1, Math.round(totalEntries / targetSize));
  const sizes = [];
  let remaining = totalEntries;
  for (let index = 0; index < roomCount; index += 1) {
    const remainingRooms = roomCount - index;
    const num = remainingRooms === 1 ? remaining : Math.min(targetSize, remaining - (remainingRooms - 1));
    sizes.push(num);
    remaining -= num;
  }
  return sizes;
}
