class HtmlTable {
    constructor(awardsImages) {
        this.contents = `<html>
        <head>
        <style type="text/css">
            .tg {border-collapse:collapse;border-spacing:0;}
            .tg td{border-color:black;border-style:solid;border-width:2px;font-family:Arial, sans-serif;font-size:14px;overflow:hidden;padding:10px 5px;word-break:normal;}
            .tg th{border-color:black;border-style:solid;border-width:2px;font-family:Arial, sans-serif;font-size:14px;font-weight:normal;overflow:hidden;padding:10px 5px;word-break:normal;}
            .tg .tg-table-cell{text-align:center;vertical-align:center;}
            .tg .tg-first-column{font-weight:bold;text-align:left;vertical-align:center;}
            .tg .tg-total-column{font-weight:bold;text-align:right;vertical-align:center;}            
            .tg img{width:32px;height:32px;}
        </style>
        </head>
        <body>
        <table class="tg" id="mainTable">
        <thead>
        <tr>
        <th class="tg-table-cell"></th>`; // First cell should be empty to allow for proper table look

        awardsImages.forEach(item => {
            this.contents += `<th class="tg-table-cell"><img src="{{${item.name}}}" alt="${item.description}"/></th>`;
        });

        this.contents += '<th class="tg-total-column">Score</th></tr></thead><tbody>';
    }

    // Add User data row to the html
    addRow(userName, awards) {
        let rowContents = '<tr>';
        rowContents += `<td class="tg-first-column">${userName}</td>`;

        // Last element contains total score and is going to be in a separate style column
        awards.slice(0, -1).forEach(award => {
            rowContents += `<td class="tg-table-cell">${award === 0 ? '' : award}</td>`;
        });

        rowContents += `<td class="tg-total-column">${awards.pop()}</td></tr>`;

        this.contents += rowContents;
    };

    // Complete html document by adding necessary closing tags
    complete() {
        this.contents += '</tbody></table></body></html>'
    };
}

class HtmlTableHelper {
    static generateHTMLTable(awards, userStats) {
        const htmlTable = new HtmlTable(awards.map(award => { return { name: award._id, description: award.userText } }));
        userStats.forEach(userStat => { htmlTable.addRow(userStat.displayName, userStat.awardsCount) });
        htmlTable.complete();

        return htmlTable;
    }
}

module.exports = {
    HtmlTableHelper
};