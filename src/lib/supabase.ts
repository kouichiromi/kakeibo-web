import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://dqekavqemejjhjbyvskx.supabase.co"
const supabaseKey = "sb_publishable_8quv4pKSZ1C4kn4UgUKMKw_L2mY1Kwd"

export const supabase = createClient(supabaseUrl, supabaseKey);