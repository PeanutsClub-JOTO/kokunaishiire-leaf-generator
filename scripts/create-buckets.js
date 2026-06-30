import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const { data, error } = await supabase.storage.createBucket('leaflet-images', { public: true });
  if (error) console.log('Error creating bucket:', error.message);
  else console.log('Bucket created:', data);
}
main();
