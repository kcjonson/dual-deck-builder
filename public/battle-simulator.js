// This file provides the interface between the HTML page and the TypeScript battle simulator

let battleSimulator = null;

async function initializeSimulator() {
	// Wait for the BattleSimulator to be available
	if (!window.BattleSimulator) {
		console.error('BattleSimulator not loaded yet');
		return;
	}
	
	battleSimulator = new window.BattleSimulator();
	await battleSimulator.initialize();
	console.log('Battle simulator initialized');
}

async function runBattle() {
	const runButton = document.getElementById('run-battle');
	const loadingDiv = document.getElementById('loading');
	const resultsDiv = document.getElementById('results');
	const logContainer = document.getElementById('log-container');
	
	// Disable button and show loading
	runButton.disabled = true;
	loadingDiv.style.display = 'block';
	resultsDiv.classList.remove('show');
	logContainer.innerHTML = '';
	
	try {
		// Initialize simulator if needed
		if (!battleSimulator) {
			await initializeSimulator();
		}
		
		// Get setup from form
		const setup = {
			playerAI: document.getElementById('player-ai').value,
			enemyAI: document.getElementById('enemy-ai').value,
			playerDrivers: [
				document.getElementById('player-driver-1').value,
				document.getElementById('player-driver-2').value
			],
			enemyDrivers: [
				document.getElementById('enemy-driver-1').value,
				document.getElementById('enemy-driver-2').value
			]
		};
		
		console.log('Running battle with setup:', setup);
		
		// Run the battle
		const result = await battleSimulator.runBattle(setup);
		
		console.log('Battle result:', result);
		
		// Display results
		displayResults(result);
		
		// Display battle log
		displayBattleLog(result.messages);
		
	} catch (error) {
		console.error('Error running battle:', error);
		alert('Error running battle: ' + error.message);
	} finally {
		// Re-enable button and hide loading
		runButton.disabled = false;
		loadingDiv.style.display = 'none';
	}
}

function displayResults(result) {
	const resultsDiv = document.getElementById('results');
	const winnerDiv = document.getElementById('winner');
	const playerStatsDiv = document.getElementById('player-stats');
	const enemyStatsDiv = document.getElementById('enemy-stats');
	
	// Show results
	resultsDiv.classList.add('show');
	
	// Display winner
	let winnerText = '';
	let winnerClass = '';
	
	switch (result.winner) {
		case 'player':
			winnerText = '🏆 Player Team Wins!';
			winnerClass = 'player';
			break;
		case 'enemy':
			winnerText = '💀 Enemy Team Wins!';
			winnerClass = 'enemy';
			break;
		case 'tie':
			winnerText = '🤝 Battle Ended in a Tie!';
			winnerClass = 'tie';
			break;
	}
	
	winnerDiv.textContent = winnerText + ` (Turn ${result.finalTurn})`;
	winnerDiv.className = 'winner ' + winnerClass;
	
	// Display team stats
	playerStatsDiv.innerHTML = formatTeamStats(result.playerTeamStats);
	enemyStatsDiv.innerHTML = formatTeamStats(result.enemyTeamStats);
}

function formatTeamStats(teamStats) {
	let html = '';
	
	teamStats.vehicles.forEach((vehicle, index) => {
		const structurePercent = Math.round((vehicle.structure / vehicle.maxStructure) * 100);
		const structureColor = structurePercent > 50 ? '#69db7c' : (structurePercent > 25 ? '#ffd43b' : '#ff6b6b');
		
		html += `<div style="margin-bottom: 15px;">`;
		html += `<strong>${vehicle.name}</strong><br>`;
		html += `Structure: <span style="color: ${structureColor}">${vehicle.structure}/${vehicle.maxStructure} (${structurePercent}%)</span><br>`;
		
		if (vehicle.driver) {
			const hpPercent = Math.round((vehicle.driver.hitpoints / vehicle.driver.maxHitpoints) * 100);
			const hpColor = hpPercent > 50 ? '#69db7c' : (hpPercent > 25 ? '#ffd43b' : '#ff6b6b');
			html += `Driver: ${vehicle.driver.name}<br>`;
			html += `HP: <span style="color: ${hpColor}">${vehicle.driver.hitpoints}/${vehicle.driver.maxHitpoints} (${hpPercent}%)</span>`;
		} else {
			html += `<span style="color: #868e96">No Driver (Vehicle Destroyed)</span>`;
		}
		
		html += `</div>`;
	});
	
	return html;
}

function displayBattleLog(messages) {
	const logContainer = document.getElementById('log-container');
	
	// Clear existing log
	logContainer.innerHTML = '';
	
	// Add each message
	messages.forEach(message => {
		const entry = document.createElement('div');
		entry.className = 'log-entry ' + message.type;
		entry.textContent = `[Turn ${message.turn}] ${message.message}`;
		logContainer.appendChild(entry);
	});
	
	// Scroll to bottom
	logContainer.scrollTop = logContainer.scrollHeight;
}

// Initialize when page loads
window.addEventListener('DOMContentLoaded', async () => {
	console.log('Page loaded, waiting for BattleSimulator...');
	
	// Wait a bit for webpack to load the bundle
	setTimeout(async () => {
		try {
			await initializeSimulator();
		} catch (error) {
			console.error('Failed to initialize simulator:', error);
		}
	}, 100);
});