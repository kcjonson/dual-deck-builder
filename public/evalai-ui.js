// AI Evaluator interface for the standalone HTML page

let evaluator = null;
let currentEvaluation = null;

// Initialize function that can be called immediately
function initializeEvaluator() {
	// Wait for AIEvaluator to be available from the webpack bundle
	if (window.AIEvaluator) {
		try {
			evaluator = new window.AIEvaluator();
			console.log('AI Evaluator initialized successfully:', evaluator);
		} catch (error) {
			console.error('Error creating AIEvaluator instance:', error);
			return;
		}
		
		// Set up event listeners
		const runButton = document.getElementById('run-evaluation');

		if (runButton) {
			runButton.addEventListener('click', function(e) {
				runEvaluation();
			});
		} else {
			console.error('Run button not found');
		}
		
		const toggleButton = document.getElementById('toggle-details-btn');
		if (toggleButton) {
			toggleButton.addEventListener('click', toggleDetailedResults);
		} else {
			console.error('Toggle button not found');
		}
	} else {
		console.error('AIEvaluator not loaded yet');
		// Try again after a short delay
		setTimeout(initializeEvaluator, 100);
	}
}

// Initialize immediately when this script loads
console.log('evalai-ui.js starting initialization');
initializeEvaluator();

async function runEvaluation() {
	console.log('runEvaluation called');
	
	if (!evaluator) {
		console.error('Evaluator not initialized');
		alert('AI Evaluator not initialized. Please refresh the page.');
		return;
	}
	
	// Get selected AI types
	const aiTypes = [];
	if (document.getElementById('ai-random').checked) aiTypes.push('random');
	if (document.getElementById('ai-aggressive').checked) aiTypes.push('aggressive');
	if (document.getElementById('ai-mcts').checked) aiTypes.push('mcts');
	
	console.log('Selected AI types:', aiTypes);
	
	if (aiTypes.length < 2) {
		alert('Please select at least 2 AI types to evaluate');
		return;
	}
	
	// Get configuration
	const gamesPerMatchup = parseInt(document.getElementById('games-per-matchup').value) || 10;
	const randomizeDrivers = document.getElementById('randomize-drivers').checked;
	
	// Show spinner
	const spinner = document.getElementById('spinner');
	spinner.classList.add('show');
	
	// Disable run button
	const runButton = document.getElementById('run-evaluation');
	runButton.disabled = true;
	runButton.textContent = 'Running...';
	
	// Show progress
	document.getElementById('progress').classList.add('show');
	document.getElementById('results').classList.remove('show');
	
	// Create evaluation config
	const config = {
		aiTypes: aiTypes,
		gamesPerMatchup: gamesPerMatchup,
		randomizeDrivers: randomizeDrivers,
		verbose: true
	};
	
	// Use setTimeout to allow the browser to render the spinner
	setTimeout(async () => {
		try {
			// Calculate total games for progress tracking
			const totalMatchups = (aiTypes.length * (aiTypes.length - 1)) / 2;
			const totalGames = totalMatchups * gamesPerMatchup * 2; // *2 because we run both permutations
			
			// Update progress
			updateProgress(0, `Running ${totalGames} total games (each matchup played with swapped positions)...`);
			
			console.log('Starting evaluation with config:', config);
			
			// Run evaluation with progress tracking
			const startTime = Date.now();
			const results = await evaluator.evaluateAllAI(config);
			const duration = ((Date.now() - startTime) / 1000).toFixed(1);
			
			console.log('Evaluation completed, results:', results);
			
			// Store results
			currentEvaluation = results;
			
			// Display results
			displayResults(results, duration);
			
			// Hide progress, show results
			document.getElementById('progress').classList.remove('show');
			document.getElementById('results').classList.add('show');
			
		} catch (error) {
			console.error('Evaluation error:', error);
			console.error('Error stack:', error.stack);
			alert(`Error running evaluation: ${error.message}`);
			
			// Hide progress on error
			document.getElementById('progress').classList.remove('show');
		} finally {
			// Hide spinner
			spinner.classList.remove('show');
			
			// Re-enable run button
			runButton.disabled = false;
			runButton.textContent = 'Run AI Evaluation';
		}
	}, 10); // Small delay to allow DOM to update
}

function updateProgress(percentage, text) {
	document.getElementById('progress-text').textContent = text;
	document.getElementById('progress-fill').style.width = percentage + '%';
}

function displayResults(results, duration) {
	// Convert Map to array and sort by win rate
	const sortedResults = Array.from(results.values()).sort((a, b) => b.winRate - a.winRate);
	
	// Display rankings
	const rankingsContainer = document.getElementById('rankings-container');
	rankingsContainer.innerHTML = '';
	
	sortedResults.forEach((result, index) => {
		const isWinner = index === 0;
		const rankingItem = document.createElement('div');
		rankingItem.className = 'ranking-item' + (isWinner ? ' winner' : '');
		
		const nameSection = document.createElement('div');
		nameSection.innerHTML = `
			<strong>#${index + 1} ${formatAIName(result.aiType)}</strong>
			${isWinner ? ' 🏆 BEST AI' : ''}
		`;
		
		const detailsSection = document.createElement('div');
		detailsSection.className = 'ranking-details';
		detailsSection.innerHTML = `
			<span>Win Rate: <strong>${(result.winRate * 100).toFixed(1)}%</strong></span>
			<span>Record: ${result.wins}W-${result.losses}L-${result.draws}D</span>
			<span>Avg Turns: ${result.avgTurnsPerGame.toFixed(1)}</span>
			<span>Avg Score: ${result.avgScorePerGame.toFixed(0)}</span>
		`;
		
		rankingItem.appendChild(nameSection);
		rankingItem.appendChild(detailsSection);
		rankingsContainer.appendChild(rankingItem);
	});
	
	// Add evaluation summary
	const summaryText = document.createElement('p');
	summaryText.style.textAlign = 'center';
	summaryText.style.marginTop = '20px';
	summaryText.innerHTML = `Evaluation completed in ${duration} seconds`;
	rankingsContainer.appendChild(summaryText);
	
	// Display head-to-head matchups
	displayMatchups(results);
	
	// Prepare detailed results
	prepareDetailedResults(results);
}

function displayMatchups(results) {
	const matchupsContainer = document.getElementById('matchups-container');
	matchupsContainer.innerHTML = '';
	
	// For each AI, show its performance against others
	for (const [aiType, result] of results) {
		// Calculate matchup statistics
		const matchupStats = new Map();
		
		for (const match of result.matchResults) {
			const opponent = match.player1AI === aiType ? match.player2AI : match.player1AI;
			if (!matchupStats.has(opponent)) {
				matchupStats.set(opponent, { wins: 0, losses: 0, draws: 0 });
			}
			
			const stats = matchupStats.get(opponent);
			if (match.player1AI === aiType) {
				if (match.winner === 'player1') stats.wins++;
				else if (match.winner === 'player2') stats.losses++;
				else stats.draws++;
			} else {
				if (match.winner === 'player2') stats.wins++;
				else if (match.winner === 'player1') stats.losses++;
				else stats.draws++;
			}
		}
		
		// Create matchup card
		const card = document.createElement('div');
		card.className = 'matchup-card';
		
		let cardHTML = `<h4>${formatAIName(aiType)}</h4><div class="matchup-stats">`;
		
		for (const [opponent, stats] of matchupStats) {
			const total = stats.wins + stats.losses + stats.draws;
			const winRate = total > 0 ? (stats.wins / total * 100).toFixed(1) : '0.0';
			
			cardHTML += `
				<div>
					vs ${formatAIName(opponent)}: 
					<span class="win-rate">${stats.wins}W</span>-<span class="loss-rate">${stats.losses}L</span>-${stats.draws}D
					(${winRate}% win rate)
				</div>
			`;
		}
		
		cardHTML += '</div>';
		card.innerHTML = cardHTML;
		matchupsContainer.appendChild(card);
	}
}

function prepareDetailedResults(results) {
	const detailedContainer = document.getElementById('detailed-container');
	detailedContainer.innerHTML = '';
	
	let matchIndex = 0;
	for (const result of results.values()) {
		for (const match of result.matchResults) {
			matchIndex++;
			
			const matchEntry = document.createElement('div');
			matchEntry.className = 'match-entry';
			
			const winnerText = match.winner === 'draw' 
				? 'Draw' 
				: match.winner === 'player1' 
					? formatAIName(match.player1AI) 
					: formatAIName(match.player2AI);
			
			const winnerColor = match.winner === 'draw' 
				? '#ffd43b' 
				: match.winner === 'player1' 
					? '#69db7c' 
					: '#ff6b6b';
			
			const matchId = `match-${matchIndex}`;
			const player1Label = `${formatAIName(match.player1AI)} <span style="color: #69db7c; font-size: 12px;">(First)</span>`;
			const player2Label = `${formatAIName(match.player2AI)} <span style="color: #ff6b6b; font-size: 12px;">(Second)</span>`;
			
			matchEntry.innerHTML = `
				<div class="match-header">
					Match ${matchIndex}: ${player1Label} vs ${player2Label}
				</div>
				<div class="match-details">
					Winner: <span style="color: ${winnerColor}; font-weight: bold;">${winnerText}</span> | 
					Turns: ${match.turnsPlayed} | 
					Scores: ${match.player1Score} vs ${match.player2Score} | 
					Drivers: ${match.player1Drivers.join(', ')}
					<span class="battle-log-link" onclick="toggleBattleLog('${matchId}')">Show Battle Log</span>
				</div>
				<div id="${matchId}-log" class="battle-log-container">
					${formatBattleLog(match.battleLog)}
				</div>
			`;
			
			detailedContainer.appendChild(matchEntry);
		}
	}
}

function formatAIName(aiType) {
	const names = {
		'random': 'Random AI',
		'aggressive': 'Aggressive Flanker AI',
		'mcts': 'Monte Carlo Tree Search AI'
	};
	return names[aiType] || aiType;
}

function toggleDetailedResults() {
	const detailedResults = document.getElementById('detailed-results');
	const button = document.getElementById('toggle-details-btn');
	
	if (detailedResults.style.display === 'none') {
		detailedResults.style.display = 'block';
		button.textContent = 'Hide Detailed Match Results';
	} else {
		detailedResults.style.display = 'none';
		button.textContent = 'Show Detailed Match Results';
	}
}

// Helper function to format battle log
function formatBattleLog(battleLog) {
	if (!battleLog || battleLog.length === 0) {
		return '<div class="battle-log-entry">No battle log available</div>';
	}
	
	return battleLog.map(entry => 
		`<div class="battle-log-entry">${entry}</div>`
	).join('');
}

// Helper function to toggle battle log visibility
function toggleBattleLog(matchId) {
	const logContainer = document.getElementById(`${matchId}-log`);
	const link = event.target;
	
	if (logContainer.classList.contains('show')) {
		logContainer.classList.remove('show');
		link.textContent = 'Show Battle Log';
	} else {
		logContainer.classList.add('show');
		link.textContent = 'Hide Battle Log';
	}
}

// Make functions available globally for onclick handlers
window.runEvaluation = runEvaluation;
window.toggleDetailedResults = toggleDetailedResults;
window.toggleBattleLog = toggleBattleLog;

