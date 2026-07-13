import { FarmScanner } from "@/src/components/farm-scanner";
import { getStoredFarmScanner } from "@/src/operations/farms";

export const revalidate = 30;

export default async function DiscoverPage() {
  const initialData = await getStoredFarmScanner();
  return <FarmScanner initialData={initialData} />;
}
