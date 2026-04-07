import { config } from 'dotenv'
config({ path: '.env.local' })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { NHL_TEAMS } from '../lib/nhl-teams-data'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Seeding NHL teams...')
  for (const team of NHL_TEAMS) {
    await prisma.nhlTeam.upsert({
      where: { id: team.id },
      update: {
        name: team.name,
        city: team.city,
        abbreviation: team.abbreviation,
        conference: team.conference,
        division: team.division,
        colorPrimary: team.colorPrimary,
        colorSecondary: team.colorSecondary,
      },
      create: {
        id: team.id,
        name: team.name,
        city: team.city,
        abbreviation: team.abbreviation,
        conference: team.conference,
        division: team.division,
        colorPrimary: team.colorPrimary,
        colorSecondary: team.colorSecondary,
      },
    })
  }
  console.log(`Seeded ${NHL_TEAMS.length} teams.`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
