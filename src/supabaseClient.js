// src/supabaseClient.js
import { createClient } from '@supabase/supabase-js'

// Replace these with your actual URL and Key from the Supabase dashboard
const supabaseUrl = 'https://vasbbsqykdowkykizwud.supabase.co'
const supabaseKey = 'sb_publishable_s3dGOMtav_4D7hQ2PtRyUw_iaAQCJwm'

export const supabase = createClient(supabaseUrl, supabaseKey)