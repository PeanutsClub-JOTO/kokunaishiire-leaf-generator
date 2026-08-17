require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data, error } = await supabase.from('leaflets').select('id, leaf_name, render_status, render_error, created_at, group_id').order('created_at', { ascending: false }).limit(5);
  console.log(data, error);
}
run();
