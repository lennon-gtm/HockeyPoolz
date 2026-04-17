import { NextRequest, NextResponse } from 'next/server'
import { syncInjuries } from '@/lib/injury-service'

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await syncInjuries()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    console.error('sync-injuries error:', error)
    return NextResponse.json({ error: 'Sync failed', details: String(error) }, { status: 500 })
  }
}
