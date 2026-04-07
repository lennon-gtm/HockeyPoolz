export interface NhlTeamData {
  id: string
  name: string
  city: string
  abbreviation: string
  conference: 'east' | 'west'
  division: string
  colorPrimary: string
  colorSecondary: string
}

export const NHL_TEAMS: NhlTeamData[] = [
  // Eastern — Atlantic
  { id: 'BOS', name: 'Bruins',        city: 'Boston',       abbreviation: 'BOS', conference: 'east', division: 'Atlantic',     colorPrimary: '#FFB81C', colorSecondary: '#010101' },
  { id: 'BUF', name: 'Sabres',        city: 'Buffalo',      abbreviation: 'BUF', conference: 'east', division: 'Atlantic',     colorPrimary: '#002654', colorSecondary: '#FCB514' },
  { id: 'DET', name: 'Red Wings',     city: 'Detroit',      abbreviation: 'DET', conference: 'east', division: 'Atlantic',     colorPrimary: '#CE1126', colorSecondary: '#FFFFFF' },
  { id: 'FLA', name: 'Panthers',      city: 'Florida',      abbreviation: 'FLA', conference: 'east', division: 'Atlantic',     colorPrimary: '#041E42', colorSecondary: '#C8102E' },
  { id: 'MTL', name: 'Canadiens',     city: 'Montréal',     abbreviation: 'MTL', conference: 'east', division: 'Atlantic',     colorPrimary: '#AF1E2D', colorSecondary: '#192168' },
  { id: 'OTT', name: 'Senators',      city: 'Ottawa',       abbreviation: 'OTT', conference: 'east', division: 'Atlantic',     colorPrimary: '#C8102E', colorSecondary: '#C69214' },
  { id: 'TBL', name: 'Lightning',     city: 'Tampa Bay',    abbreviation: 'TBL', conference: 'east', division: 'Atlantic',     colorPrimary: '#002868', colorSecondary: '#FFFFFF' },
  { id: 'TOR', name: 'Maple Leafs',   city: 'Toronto',      abbreviation: 'TOR', conference: 'east', division: 'Atlantic',     colorPrimary: '#00205B', colorSecondary: '#FFFFFF' },
  // Eastern — Metropolitan
  { id: 'CAR', name: 'Hurricanes',    city: 'Carolina',     abbreviation: 'CAR', conference: 'east', division: 'Metropolitan', colorPrimary: '#CC0000', colorSecondary: '#000000' },
  { id: 'CBJ', name: 'Blue Jackets',  city: 'Columbus',     abbreviation: 'CBJ', conference: 'east', division: 'Metropolitan', colorPrimary: '#002654', colorSecondary: '#CE1126' },
  { id: 'NJD', name: 'Devils',        city: 'New Jersey',   abbreviation: 'NJD', conference: 'east', division: 'Metropolitan', colorPrimary: '#CE1126', colorSecondary: '#003366' },
  { id: 'NYI', name: 'Islanders',     city: 'New York',     abbreviation: 'NYI', conference: 'east', division: 'Metropolitan', colorPrimary: '#00539B', colorSecondary: '#F47D30' },
  { id: 'NYR', name: 'Rangers',       city: 'New York',     abbreviation: 'NYR', conference: 'east', division: 'Metropolitan', colorPrimary: '#0038A8', colorSecondary: '#CE1126' },
  { id: 'PHI', name: 'Flyers',        city: 'Philadelphia', abbreviation: 'PHI', conference: 'east', division: 'Metropolitan', colorPrimary: '#F74902', colorSecondary: '#000000' },
  { id: 'PIT', name: 'Penguins',      city: 'Pittsburgh',   abbreviation: 'PIT', conference: 'east', division: 'Metropolitan', colorPrimary: '#FCB514', colorSecondary: '#000000' },
  { id: 'WSH', name: 'Capitals',      city: 'Washington',   abbreviation: 'WSH', conference: 'east', division: 'Metropolitan', colorPrimary: '#041E42', colorSecondary: '#C8102E' },
  // Western — Central
  { id: 'CHI', name: 'Blackhawks',    city: 'Chicago',      abbreviation: 'CHI', conference: 'west', division: 'Central',      colorPrimary: '#CF0A2C', colorSecondary: '#FF671B' },
  { id: 'COL', name: 'Avalanche',     city: 'Colorado',     abbreviation: 'COL', conference: 'west', division: 'Central',      colorPrimary: '#6F263D', colorSecondary: '#236192' },
  { id: 'DAL', name: 'Stars',         city: 'Dallas',       abbreviation: 'DAL', conference: 'west', division: 'Central',      colorPrimary: '#006847', colorSecondary: '#8F8F8C' },
  { id: 'MIN', name: 'Wild',          city: 'Minnesota',    abbreviation: 'MIN', conference: 'west', division: 'Central',      colorPrimary: '#154734', colorSecondary: '#A6192E' },
  { id: 'NSH', name: 'Predators',     city: 'Nashville',    abbreviation: 'NSH', conference: 'west', division: 'Central',      colorPrimary: '#FFB81C', colorSecondary: '#041E42' },
  { id: 'STL', name: 'Blues',         city: 'St. Louis',    abbreviation: 'STL', conference: 'west', division: 'Central',      colorPrimary: '#002F87', colorSecondary: '#FCB514' },
  { id: 'UTA', name: 'Hockey Club',   city: 'Utah',         abbreviation: 'UTA', conference: 'west', division: 'Central',      colorPrimary: '#6CACE4', colorSecondary: '#010101' },
  { id: 'WPG', name: 'Jets',          city: 'Winnipeg',     abbreviation: 'WPG', conference: 'west', division: 'Central',      colorPrimary: '#041E42', colorSecondary: '#004C97' },
  // Western — Pacific
  { id: 'ANA', name: 'Ducks',         city: 'Anaheim',      abbreviation: 'ANA', conference: 'west', division: 'Pacific',      colorPrimary: '#F47A38', colorSecondary: '#B09865' },
  { id: 'CGY', name: 'Flames',        city: 'Calgary',      abbreviation: 'CGY', conference: 'west', division: 'Pacific',      colorPrimary: '#C8102E', colorSecondary: '#F1BE48' },
  { id: 'EDM', name: 'Oilers',        city: 'Edmonton',     abbreviation: 'EDM', conference: 'west', division: 'Pacific',      colorPrimary: '#FF4C00', colorSecondary: '#003087' },
  { id: 'LAK', name: 'Kings',         city: 'Los Angeles',  abbreviation: 'LAK', conference: 'west', division: 'Pacific',      colorPrimary: '#111111', colorSecondary: '#A2AAAD' },
  { id: 'SJS', name: 'Sharks',        city: 'San Jose',     abbreviation: 'SJS', conference: 'west', division: 'Pacific',      colorPrimary: '#006D75', colorSecondary: '#EA7200' },
  { id: 'SEA', name: 'Kraken',        city: 'Seattle',      abbreviation: 'SEA', conference: 'west', division: 'Pacific',      colorPrimary: '#001628', colorSecondary: '#99D9D9' },
  { id: 'VAN', name: 'Canucks',       city: 'Vancouver',    abbreviation: 'VAN', conference: 'west', division: 'Pacific',      colorPrimary: '#00205B', colorSecondary: '#00843D' },
  { id: 'VGK', name: 'Golden Knights', city: 'Vegas',       abbreviation: 'VGK', conference: 'west', division: 'Pacific',      colorPrimary: '#B4975A', colorSecondary: '#333F42' },
]
